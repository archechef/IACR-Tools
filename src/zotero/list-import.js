/**
 * Adds the papers of a reading list to the library.
 *
 * Every entry — an ePrint id, a DOI, a CryptoBib key or a title — is resolved
 * to metadata (CryptoBib first, then the ePrint paper page, then Zotero's own
 * DOI lookup, then the ePrint full-text search), checked against the library,
 * and added as an item whose ePrint PDF can be downloaded right away.
 */
import { eprintPaperFromPage } from "../core/eprint-page.js";
import { eprintIdOf } from "../core/mapping.js";
import { EPRINT } from "../config.js";
import { createItemFromEprintPaper, createItemFromRecord } from "./create-item.js";
import { LibraryIndex } from "./library-index.js";

/**
 * @typedef {"added" | "updated" | "exists" | "not-found" | "failed"} ListStatus
 * @typedef {{ status: ListStatus, item?: any, detail?: string }} ListResult
 */

/**
 * @typedef {object} ListOptions
 * @property {number} libraryID
 * @property {number | null} collectionID
 * @property {import("./pipeline.js").Action[]} metadataActions  Run on new items (CryptoBib sync).
 * @property {import("./pipeline.js").Action[]} eprintActions    Run on new and on existing items.
 */

export class ListImporter {
	/**
	 * @param {object} deps
	 * @param {any} deps.Zotero
	 * @param {import("./platform.js").Http} deps.http
	 * @param {import("./platform.js").FileStore} deps.files
	 * @param {import("./cryptobib-store.js").CryptoBibStore} deps.store
	 * @param {import("./pipeline.js").Pipeline} deps.pipeline
	 * @param {import("./eprint-sources.js").EprintFinder} deps.finder
	 * @param {() => string} deps.eprintKey
	 * @param {() => () => void} deps.suspendAutoProcessing
	 * @param {(msg: string) => void} deps.log
	 */
	constructor({ Zotero, http, files, store, pipeline, finder, eprintKey, suspendAutoProcessing, log }) {
		this.Zotero = Zotero;
		this.http = http;
		this.files = files;
		this.store = store;
		this.pipeline = pipeline;
		this.finder = finder;
		this.eprintKey = eprintKey;
		this.suspendAutoProcessing = suspendAutoProcessing;
		this.log = log;
	}

	/**
	 * @param {import("../core/list.js").ListEntry[]} entries
	 * @param {ListOptions} options
	 * @param {{ onEntryDone?: (entry: any, result: ListResult) => void }} [hooks]
	 * @returns {Promise<Array<{ entry: any, result: ListResult }>>}
	 */
	async run(entries, options, { onEntryDone = () => {} } = {}) {
		const resume = this.suspendAutoProcessing();
		const summary = [];
		try {
			// The list import compares papers only, never files.
			const index = await new LibraryIndex({ Zotero: this.Zotero, files: this.files, eprintKey: this.eprintKey() })
				.load(options.libraryID, { files: false });
			for (const entry of entries) {
				/** @type {ListResult} */
				let result;
				try {
					result = await this.#addEntry(entry, options, index);
				}
				catch (e) {
					this.log(`Adding "${entry.raw}" failed: ${e}\n${e.stack ?? ""}`);
					result = { status: "failed", detail: String(e.message ?? e) };
				}
				onEntryDone(entry, result);
				summary.push({ entry, result });
			}
		}
		finally {
			resume();
		}
		return summary;
	}

	/** @returns {Promise<ListResult>} */
	async #addEntry(entry, options, index) {
		const found = await this.#resolve(entry);
		if (!found) {
			return entry.doi
				? this.#addByDOI(entry, options, index)
				: /** @type {ListResult} */ ({ status: "not-found", detail: entry.raw });
		}

		const existing = index.findReference(found.reference, found.eprintId);
		if (existing) return this.#updateExisting(existing, options);

		const context = { libraryID: options.libraryID, collectionID: options.collectionID, eprintKey: this.eprintKey() };
		const item = found.record
			? await createItemFromRecord(this.Zotero, found.record, context)
			: await createItemFromEprintPaper(this.Zotero, found.paper, context);
		index.addPaper(item);
		const detail = await this.#runActions(item, [...options.metadataActions, ...options.eprintActions]);
		return /** @type {ListResult} */ ({ status: "added", item, detail: [found.source, detail].filter(Boolean).join(" · ") });
	}

	/** An entry whose paper is already in the library: only its ePrint PDF may be missing. */
	async #updateExisting(item, options) {
		await this.#addToCollection(item, options.collectionID);
		const detail = await this.#runActions(item, options.eprintActions);
		return /** @type {ListResult} */ ({ status: detail ? "updated" : "exists", item, detail });
	}

	/** @returns {Promise<string | undefined>} details of the actions that changed something */
	async #runActions(item, actions) {
		if (!actions.length) return undefined;
		const [{ results } = { results: [] }] = await this.pipeline.run([item], actions);
		const detail = results.filter((r) => r.status === "changed" || r.status === "failed")
			.map((r) => r.detail).filter(Boolean).join(" \u00b7 ");
		return detail || undefined;
	}

	async #addToCollection(item, collectionID) {
		if (!collectionID || item.parentItemID || item.inCollection(collectionID)) return;
		item.addToCollection(collectionID);
		await item.saveTx();
	}

	/**
	 * Resolves an entry to a CryptoBib record (preferred: it carries the venue
	 * and the citation key) or to the paper's ePrint page.
	 * @returns {Promise<{ record?: any, paper?: any, reference: import("../core/matching.js").Reference, eprintId: string | null | undefined, source: string } | null>}
	 */
	async #resolve(entry) {
		const index = await this.#cryptoBib();
		const titles = [entry.title, entry.hint].filter(Boolean);
		const byTitle = (find) => titles.map((title) => find({ title, authors: [] })?.candidate).find(Boolean);
		// Identifiers the list states explicitly come first; a title given behind
		// an identifier is a fallback for when that identifier leads nowhere.
		const record = (entry.key && index?.getByKey(entry.key))
			|| (entry.eprintId && index?.getEprint(entry.eprintId))
			|| (entry.doi && index?.getPublicationByDOI(entry.doi))
			|| byTitle((query) => index?.findPublication(query))
			|| byTitle((query) => index?.findEprint(query))
			|| null;
		if (record) {
			return {
				record,
				reference: { title: record.title, authors: record.authors, year: record.year, doi: record.doi },
				eprintId: eprintIdOf(record),
				source: "CryptoBib",
			};
		}

		const eprintId = entry.eprintId ?? (await this.#searchEprintId(titles));
		const paper = eprintId ? await this.#fetchEprintPaper(eprintId) : null;
		if (paper) {
			return {
				paper,
				reference: { title: paper.title, authors: paper.creators.map((c) => c.lastName) },
				eprintId,
				source: EPRINT.repositoryName,
			};
		}
		// A stated ePrint id that has no page (withdrawn, mistyped): try the title.
		if (entry.eprintId && titles.length) {
			const searched = await this.#searchEprintId(titles);
			const fallback = searched && searched !== eprintId ? await this.#fetchEprintPaper(searched) : null;
			if (fallback) {
				return {
					paper: fallback,
					reference: { title: fallback.title, authors: fallback.creators.map((c) => c.lastName) },
					eprintId: searched,
					source: EPRINT.repositoryName,
				};
			}
		}
		return null;
	}

	/** The ePrint id of a paper known only by title, from the online sources. */
	async #searchEprintId(titles) {
		for (const title of titles) {
			try {
				const hit = await this.finder.find({ title, authors: [] });
				if (hit) return hit.id;
			}
			catch (e) {
				this.log(`ePrint search for "${title}" failed: ${e}`);
			}
		}
		return null;
	}

	async #fetchEprintPaper(id) {
		try {
			return eprintPaperFromPage(id, await this.http.getDocument(EPRINT.pageURL(id)));
		}
		catch (e) {
			this.log(`Cannot read the ePrint page of ${id}: ${e}`);
			return null;
		}
	}

	/**
	 * Last resort for a DOI that CryptoBib does not have: Zotero's own lookup,
	 * which saves the item itself, so the duplicate check follows afterwards.
	 * @returns {Promise<ListResult>}
	 */
	async #addByDOI(entry, options, index) {
		const item = await this.#translateDOI(entry.doi, options);
		if (!item) return { status: "not-found", detail: entry.raw };
		const existing = index.findPaper(item);
		if (existing) {
			await this.Zotero.Items.trashTx([item.id]);
			return this.#updateExisting(existing, options);
		}
		index.addPaper(item);
		const detail = await this.#runActions(item, [...options.metadataActions, ...options.eprintActions]);
		return /** @type {ListResult} */ ({ status: "added", item, detail: ["DOI lookup", detail].filter(Boolean).join(" \u00b7 ") });
	}

	async #translateDOI(doi, options) {
		try {
			const translate = new this.Zotero.Translate.Search();
			translate.setIdentifier({ DOI: doi });
			const translators = await translate.getTranslators();
			if (!translators.length) return null;
			translate.setTranslator(translators);
			// Several results (rare for a DOI): take the first.
			translate.setHandler("select", (_t, items, callback) => {
				const [first] = Object.keys(items);
				callback(first === undefined ? {} : { [first]: items[first] });
			});
			const items = await translate.translate({
				libraryID: options.libraryID,
				collections: options.collectionID ? [options.collectionID] : [],
				saveAttachments: false,
			});
			return items?.[0] ?? null;
		}
		catch (e) {
			this.log(`DOI lookup for ${doi} failed: ${e}`);
			return null;
		}
	}

	async #cryptoBib() {
		try {
			return await this.store.getIndex();
		}
		catch (e) {
			this.log(`CryptoBib unavailable: ${e}`);
			return null;
		}
	}
}
