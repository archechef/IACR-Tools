/**
 * Links a project folder on disk to its Zotero collection, as a LaTeX project
 * that cites the collection's papers needs it:
 *
 * - `refs/papers` becomes a link (a directory junction on Windows, which needs
 *   no admin rights) to the folder ZotMoov files the collection's PDFs in, so
 *   the PDFs show up inside the project;
 * - Better BibTeX keeps `refs/references.bib` updated with the collection's
 *   papers (its "Keep updated" export).
 *
 * `plan()` looks at what is there and changes nothing (apart from a probe file
 * it removes again); `apply()` creates what the plan says is missing. Nothing
 * that is already there is replaced, except an empty `refs/papers` folder.
 */
import { LATEX, PROJECT_FOLDER, ZOTMOOV } from "../config.js";
import { samePath, zotmoovCollectionFolders } from "../core/project-folder.js";

/**
 * @typedef {"create" | "linked" | "occupied" | "unavailable"} PapersState
 * @typedef {"create" | "exported" | "occupied" | "unavailable"} BibliographyState
 * @typedef {{
 *   link: string, target: string | null, state: PapersState,
 *   reason?: "zotmoov-missing" | "zotmoov-no-folder" | "zotmoov-subfolders",
 *   replacesEmptyFolder?: boolean,
 * }} PapersPlan
 * @typedef {{ path: string, state: BibliographyState, replacesFile?: boolean }} BibliographyPlan
 * @typedef {{ folder: string, refs: string, collection: any, papers: PapersPlan, bibliography: BibliographyPlan }} ProjectPlan
 * @typedef {{ state: "created" | "failed" | "unchanged", error?: string }} LinkOutcome
 */

export class ProjectFolders {
	/**
	 * @param {object} deps
	 * @param {any} deps.Zotero
	 * @param {import("./platform.js").FileStore} deps.files
	 * @param {(link: string, target: string) => Promise<void>} deps.makeLink  Creates a directory link.
	 * @param {(msg: string) => void} deps.log
	 */
	constructor({ Zotero, files, makeLink, log }) {
		this.Zotero = Zotero;
		this.files = files;
		this.makeLink = makeLink;
		this.log = log;
	}

	/**
	 * What linking `folder` to `collection` would do.
	 * @returns {Promise<ProjectPlan>}
	 */
	async plan(collection, folder) {
		const { files } = this;
		const refs = files.join(folder, PROJECT_FOLDER.refsFolder);
		return {
			folder,
			refs,
			collection,
			papers: await this.#planPapers(files.join(refs, PROJECT_FOLDER.papersFolder), collection),
			bibliography: await this.#planBibliography(files.join(refs, PROJECT_FOLDER.bibliographyFile), collection),
		};
	}

	/**
	 * Creates the links the plan marks "create".
	 * @param {ProjectPlan} plan
	 * @returns {Promise<{ papers: LinkOutcome, bibliography: LinkOutcome }>}
	 */
	async apply(plan) {
		const todo = plan.papers.state === "create" || plan.bibliography.state === "create";
		if (todo) await this.files.makeDirectory(plan.refs);
		return {
			papers: plan.papers.state === "create" ? await this.#linkPapers(plan.papers) : { state: "unchanged" },
			bibliography: plan.bibliography.state === "create"
				? await this.#exportBibliography(plan.bibliography, plan.collection)
				: { state: "unchanged" },
		};
	}

	/**
	 * The folder ZotMoov files the collection's PDFs in: its directory plus the
	 * collection path, when it sorts files by `{%c}`.
	 * @returns {{ folder: string } | { reason: NonNullable<PapersPlan["reason"]> }}
	 */
	zotmoovFolder(collection) {
		const { Zotero, files } = this;
		const pref = (key) => Zotero.Prefs.get(key, true);
		if (!Zotero.ZotMoov) return { reason: "zotmoov-missing" };
		const directory = String(pref(ZOTMOOV.prefs.directory) ?? "").trim();
		if (!directory) return { reason: "zotmoov-no-folder" };
		if (!pref(ZOTMOOV.prefs.subdirectories) || String(pref(ZOTMOOV.prefs.subdirectoryString) ?? "").trim() !== ZOTMOOV.collectionWildcard) {
			return { reason: "zotmoov-subfolders" };
		}
		let names = zotmoovCollectionFolders(this.#collectionNames(collection));
		if (pref(ZOTMOOV.prefs.stripDiacritics) && Zotero.Utilities?.removeDiacritics) {
			names = names.map((name) => Zotero.Utilities.removeDiacritics(name));
		}
		return { folder: files.join(directory, ...names) };
	}

	/** Names from the top-level collection down to this one. */
	#collectionNames(collection) {
		const names = [];
		for (let current = collection; current; current = current.parentID ? this.Zotero.Collections.get(current.parentID) : null) {
			names.unshift(current.name);
		}
		return names;
	}

	/** @returns {Promise<PapersPlan>} */
	async #planPapers(link, collection) {
		const found = this.zotmoovFolder(collection);
		if (!("folder" in found)) return { link, target: null, state: "unavailable", reason: found.reason };
		const target = found.folder;
		if (!(await this.files.exists(link))) return { link, target, state: "create" };
		if (await this.#shows(link, target)) return { link, target, state: "linked" };
		if (await this.#isEmptyFolder(link)) return { link, target, state: "create", replacesEmptyFolder: true };
		return { link, target, state: "occupied" };
	}

	/**
	 * Whether `link` shows the contents of `target`: a file written into the
	 * target appears under the link. This works for junctions and symbolic
	 * links alike, without reading where a link points.
	 */
	async #shows(link, target) {
		const { files } = this;
		if (!(await files.exists(target))) return false;
		const name = PROJECT_FOLDER.probeFile(`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
		const probe = files.join(target, name);
		try {
			await files.writeText(probe, "");
			return await files.exists(files.join(link, name));
		}
		catch (e) {
			this.log(`Could not check whether ${link} shows ${target}: ${e}`);
			return false;
		}
		finally {
			await files.remove(probe).catch(() => {});
		}
	}

	async #isEmptyFolder(path) {
		try {
			return (await this.files.stat(path)).type === "directory" && !(await this.files.children(path)).length;
		}
		catch {
			return false;
		}
	}

	/** @param {PapersPlan} papers */
	async #linkPapers({ link, target, replacesEmptyFolder }) {
		const { files } = this;
		try {
			if (!target) throw new Error("no folder to link to");
			await files.makeDirectory(target);
			// Non-recursive: only an empty folder can go.
			if (replacesEmptyFolder) await files.remove(link);
			await this.makeLink(link, target);
			if (!(await this.#shows(link, target))) throw new Error(`${link} does not show the files of ${target}`);
			this.log(`Linked ${link} to ${target}`);
			return { state: /** @type {const} */ ("created") };
		}
		catch (e) {
			this.log(`Linking ${link} to ${target} failed: ${e}`);
			return { state: /** @type {const} */ ("failed"), error: String(e?.message ?? e) };
		}
	}

	/** Better BibTeX's auto-exports, when it is installed. */
	get #autoExport() {
		const autoExport = this.Zotero.BetterBibTeX?.AutoExport;
		return typeof autoExport?.add === "function" && typeof autoExport.all === "function" ? autoExport : null;
	}

	/** @returns {Promise<BibliographyPlan>} */
	async #planBibliography(path, collection) {
		const autoExport = this.#autoExport;
		if (!autoExport) return { path, state: "unavailable" };
		await this.Zotero.BetterBibTeX.ready;
		const existing = autoExport.all().find((entry) => samePath(entry.path, path, { ignoreCase: Boolean(this.Zotero.isWin) }));
		if (existing) {
			const same = existing.type === "collection" && existing.id === collection.id && existing.translatorID === LATEX.translators.betterBibTeX;
			return { path, state: same ? "exported" : "occupied" };
		}
		return { path, state: "create", replacesFile: await this.files.exists(path) };
	}

	/**
	 * Registers the export as Better BibTeX's own "Keep updated" export would
	 * (the fields of its scripting API's AutoExport.add), and runs it once.
	 * @param {BibliographyPlan} bibliography
	 */
	async #exportBibliography({ path }, collection) {
		try {
			const now = Date.now();
			await this.#autoExport.add({
				enabled: true,
				type: "collection",
				id: collection.id,
				path,
				status: "done",
				recursive: false,
				created: now,
				updated: now,
				error: "",
				translatorID: LATEX.translators.betterBibTeX,
				exportNotes: false,
				useJournalAbbreviation: false,
			}, true);
			this.log(`Better BibTeX keeps ${path} updated with collection ${collection.id}`);
			return { state: /** @type {const} */ ("created") };
		}
		catch (e) {
			this.log(`Registering the export to ${path} failed: ${e}`);
			return { state: /** @type {const} */ ("failed"), error: String(e?.message ?? e) };
		}
	}
}
