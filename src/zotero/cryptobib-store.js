/**
 * Downloads, caches and loads CryptoBib.
 *
 * Layout of the cache directory (inside the Zotero data directory):
 *   crypto.bib, abbrevN.bib     raw CryptoBib export
 *   records-vX-abbrevN.json     parsed records for one abbreviation level
 *   meta.json                   { downloadedAt }
 *
 * The index is loaded lazily on first use and released after a period of
 * inactivity, because CryptoBib holds ~90 000 entries.
 */
import { CRYPTOBIB, MS_PER_DAY, NETWORK, PLUGIN, TIMING } from "../config.js";
import { MacroTable } from "../core/bibtex.js";
import { buildRecords, CryptoBibIndex } from "../core/cryptobib.js";

/** @typedef {"downloading" | "indexing" | "ready"} StoreStatus */

const ENTRY_START = /^[ \t]*@(?!string\b|comment\b|preamble\b)[A-Za-z]+[ \t]*[{(]/gim;
const STRING_DEFINITION = /^[ \t]*@string[ \t]*[{(]/im;

/** Number of BibTeX entries (not @string / @comment / @preamble) in a text. */
function countEntries(text) {
	let count = 0;
	for (const _ of (text ?? "").matchAll(ENTRY_START)) count++;
	return count;
}

export class CryptoBibStore {
	/** @type {Promise<CryptoBibIndex> | null} */
	#loading = null;
	/** @type {CryptoBibIndex | null} */
	#index = null;
	#unloadTimer = null;
	#refreshing = null;

	/**
	 * @param {object} deps
	 * @param {import("./platform.js").Http} deps.http
	 * @param {import("./platform.js").FileStore} deps.files
	 * @param {import("./prefs.js").Prefs} deps.prefs
	 * @param {string} deps.dataDirectory Zotero data directory.
	 * @param {{ setTimeout: Function, clearTimeout: Function }} deps.timers
	 * @param {(msg: string) => void} deps.log
	 * @param {() => number} [deps.now]
	 */
	constructor({ http, files, prefs, dataDirectory, timers, log, now = Date.now }) {
		this.http = http;
		this.files = files;
		this.prefs = prefs;
		this.timers = timers;
		this.log = log;
		this.now = now;
		this.directory = files.join(dataDirectory, PLUGIN.dataDirName);
	}

	get #abbrevLevel() {
		const level = Number(this.prefs.get("abbrevLevel"));
		return CRYPTOBIB.abbrevLevels.includes(level) ? level : CRYPTOBIB.abbrevLevels[0];
	}

	#path(name) {
		return this.files.join(this.directory, name);
	}

	/**
	 * Returns the CryptoBib index, downloading CryptoBib on first use. A stale
	 * copy is used immediately and refreshed in the background.
	 * @param {{ onStatus?: (status: StoreStatus) => void }} [options]
	 * @returns {Promise<CryptoBibIndex>}
	 */
	async getIndex({ onStatus = () => {} } = {}) {
		this.#scheduleUnload();
		if (this.#index) return this.#index;
		this.#loading ??= this.#load(onStatus).finally(() => {
			this.#loading = null;
		});
		return this.#loading;
	}

	/**
	 * Forces a fresh download and re-index.
	 * @param {{ onStatus?: (status: StoreStatus) => void }} [options]
	 */
	async update({ onStatus = () => {} } = {}) {
		await this.#download(onStatus);
		this.#index = await this.#buildIndex(onStatus, { rebuild: true });
		this.#scheduleUnload();
		onStatus("ready");
		return this.#index;
	}

	/** Drops the in-memory index (e.g. when the abbreviation level changes). */
	invalidate() {
		this.#index = null;
	}

	dispose() {
		this.timers.clearTimeout(this.#unloadTimer);
		this.#index = null;
	}

	async #load(onStatus) {
		const meta = await this.#readMeta();
		if (!meta) {
			await this.#download(onStatus);
		}
		else if (this.#isStale(meta)) {
			this.#refreshInBackground();
		}
		this.#index = await this.#buildIndex(onStatus, { rebuild: false });
		onStatus("ready");
		return this.#index;
	}

	#isStale(meta) {
		const maxAge = Number(this.prefs.get("cryptobibMaxAgeDays")) * MS_PER_DAY;
		return maxAge > 0 && this.now() - meta.downloadedAt > maxAge;
	}

	#refreshInBackground() {
		this.#refreshing ??= this.update()
			.catch((e) => this.log(`Background CryptoBib refresh failed: ${e}`))
			.finally(() => {
				this.#refreshing = null;
			});
	}

	async #readMeta() {
		const path = this.#path(CRYPTOBIB.metaFile);
		if (!(await this.files.exists(path))) return null;
		try {
			return JSON.parse(await this.files.readText(path));
		}
		catch (e) {
			this.log(`Ignoring unreadable ${CRYPTOBIB.metaFile}: ${e}`);
			return null;
		}
	}

	/** Downloads crypto.bib and every abbreviation file, then clears cached records. */
	async #download(onStatus) {
		onStatus("downloading");
		await this.files.makeDirectory(this.directory);
		const baseURL = String(this.prefs.get("cryptobibBaseURL")).replace(/\/?$/, "/");
		const names = [CRYPTOBIB.mainFile, ...CRYPTOBIB.abbrevLevels.map(CRYPTOBIB.abbrevFile)];
		// Download everything before writing anything so a failure leaves the old copy intact.
		const contents = await Promise.all(names.map((name) => {
			this.log(`Downloading ${baseURL}${name}`);
			return this.http.getText(baseURL + name, { timeout: NETWORK.downloadTimeoutMs });
		}));
		const entries = await this.#checkDownload(names, contents);
		for (const [i, name] of names.entries()) {
			await this.files.writeText(this.#path(name), contents[i]);
		}
		for (const level of CRYPTOBIB.abbrevLevels) {
			await this.files.writeText(this.#path(CRYPTOBIB.recordsFile(level)), "");
		}
		await this.files.writeText(this.#path(CRYPTOBIB.metaFile), JSON.stringify({ downloadedAt: this.now(), entries }));
	}

	/**
	 * Rejects a download that is not CryptoBib (an error page, an empty file) or
	 * that lost most of its entries, so that it never replaces a good copy.
	 * @returns {Promise<number>} number of entries in the main file
	 */
	async #checkDownload(names, contents) {
		const entries = countEntries(contents[0]);
		if (!entries) throw new Error(`${names[0]} contains no BibTeX entries`);
		for (const [i, name] of names.entries()) {
			if (i > 0 && !STRING_DEFINITION.test(contents[i])) throw new Error(`${name} contains no @string definitions`);
		}
		const previous = Number((await this.#readMeta())?.entries) || 0;
		if (entries < previous * CRYPTOBIB.minEntriesRatio) {
			throw new Error(`${names[0]} has only ${entries} entries (previously ${previous}); keeping the old copy`);
		}
		return entries;
	}

	async #buildIndex(onStatus, { rebuild }) {
		const level = this.#abbrevLevel;
		const recordsPath = this.#path(CRYPTOBIB.recordsFile(level));
		if (!rebuild && (await this.files.exists(recordsPath))) {
			const cached = await this.files.readText(recordsPath);
			if (cached) {
				try {
					return new CryptoBibIndex(JSON.parse(cached));
				}
				catch (e) {
					this.log(`Rebuilding corrupt CryptoBib cache: ${e}`);
				}
			}
		}
		onStatus("indexing");
		const macros = new MacroTable().load(await this.files.readText(this.#path(CRYPTOBIB.abbrevFile(level))));
		const records = await buildRecords(await this.files.readText(this.#path(CRYPTOBIB.mainFile)), macros, {
			yieldControl: () => new Promise((resolve) => this.timers.setTimeout(resolve, 0)),
		});
		await this.files.writeText(recordsPath, JSON.stringify(records));
		this.log(`Indexed ${records.length} CryptoBib entries (abbrev${level})`);
		return new CryptoBibIndex(records);
	}

	#scheduleUnload() {
		this.timers.clearTimeout(this.#unloadTimer);
		this.#unloadTimer = this.timers.setTimeout(() => {
			this.#index = null;
		}, TIMING.indexIdleUnloadMs);
	}
}
