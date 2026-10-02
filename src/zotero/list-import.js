/**
 * Adds the papers of a reading list to the library.
 *
 * Every entry — an ePrint id, a DOI, a CryptoBib key or a title — is resolved
 * to metadata (CryptoBib first, then the ePrint paper page, then Zotero's own
 * DOI lookup, then the ePrint full-text search), checked against the library,
 * and added as an item whose ePrint PDF can be downloaded right away.
 *
 * A list with sections ("[Topic]") files its papers into those subcollections
 * of the target collection, creating them when missing. With `reorganize`,
 * papers already somewhere in the target collection are moved: out of the
 * collections below it that the list does not name for them.
 */
import { eprintPaperFromPage } from "../core/eprint-page.js";
import { eprintIdOf } from "../core/mapping.js";
import { EPRINT, PREFS } from "../config.js";
import { mapConcurrent, serialized, serializedByKey } from "../core/concurrency.js";
import { relativeCollectionPath } from "../core/list.js";
import { CollectionPaths } from "./collections.js";
import { createItemFromEprintPaper, createItemFromRecord } from "./create-item.js";
import { LibraryIndex } from "./library-index.js";

/**
 * @typedef {"added" | "updated" | "moved" | "exists" | "not-found" | "failed"} ListStatus
 * @typedef {object} ListResult
 * @property {ListStatus} status
 * @property {any} [item]
 * @property {string} [detail]
 * @property {number} [refiledTo]  Set when an existing paper was moved between
 *   collections and now lives only below the target collection: the collection
 *   whose folder its files belong in (see zotmoov.js).
 */

/**
 * @typedef {object} ListOptions
 * @property {number} libraryID
 * @property {number | null} collectionID
 * @property {boolean} [reorganize]  Move papers already below the target collection into the collections the list names.
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
	 * @param {() => number} [deps.concurrency]  Entries looked up at the same time.
	 * @param {() => () => void} deps.suspendAutoProcessing
	 * @param {(msg: string) => void} deps.log
	 */
	constructor({ Zotero, http, files, store, pipeline, finder, eprintKey, concurrency = () => PREFS.concurrency.default, suspendAutoProcessing, log }) {
		this.concurrency = concurrency;
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
	 * @param {{ onEntryDone?: (entry: any, result: ListResult) => void, shouldStop?: () => boolean }} [hooks]
	 *   shouldStop: checked before each entry; once true, no new entry is started.
	 * @returns {Promise<Array<{ entry: any, result: ListResult }>>} in list order, without the entries never started
	 */
	async run(entries, options, { onEntryDone = () => {}, shouldStop } = {}) {
		const resume = this.suspendAutoProcessing();
		try {
			// The list import compares papers only, never files.
			const index = await new LibraryIndex({ Zotero: this.Zotero, files: this.files, eprintKey: this.eprintKey() })
				.load(options.libraryID, { files: false });
			const collections = new CollectionPaths(this.Zotero, options.libraryID, options.collectionID);
			const filing = {
				collections,
				basePath: collections.basePath(),
				// Reorganizing only ever touches the collections below the target.
				subtree: options.reorganize && options.collectionID ? collections.subtree() : new Set(),
				/** @type {Map<number, Set<number>>} collections each item was filed into by this run */
				claims: new Map(),
			};
			const steps = { place: serialized(), perItem: serializedByKey(), filing };
			// Entries are looked up and their PDFs downloaded in parallel; results
			// are reported as they finish and returned in list order.
			const summary = await mapConcurrent(entries, this.concurrency(), async (entry) => {
				/** @type {ListResult} */
				let result;
				try {
					result = await this.#addEntry(entry, options, index, steps);
				}
				catch (e) {
					this.log(`Adding "${entry.raw}" failed: ${e}\n${e.stack ?? ""}`);
					result = { status: "failed", detail: String(e.message ?? e) };
				}
				onEntryDone(entry, result);
				return { entry, result };
			}, { shouldStop });
			return summary.filter(Boolean);
		}
		finally {
			resume();
		}
	}

	/**
	 * Looks the entry up (in parallel with other entries), then places it in the
	 * library one entry at a time: the duplicate check and the creation of the
	 * item must not overlap, or two entries naming the same paper (an ePrint id
	 * and its title, say) would both create it.
	 * @returns {Promise<ListResult>}
	 */
	async #addEntry(entry, options, index, { place, perItem, filing }) {
		const found = await this.#resolve(entry);
		const { work } = await place(() => this.#place(entry, found, options, index, perItem, filing));
		return work;
	}

	/**
	 * Finds or creates the entry's item and queues its follow-up work (CryptoBib
	 * update, ePrint PDF). The work is queued per item, and queued here, inside
	 * the one-at-a-time step, so that two entries for the same paper never
	 * download its PDF twice and the entry that created the item goes first.
	 * @returns {Promise<{ work: Promise<ListResult> }>} wrapped, so that awaiting
	 *   this step does not wait for the work itself
	 */
	async #place(entry, found, options, index, perItem, filing) {
		const notFound = () => ({ work: Promise.resolve(/** @type {ListResult} */ ({ status: "not-found", detail: entry.raw })) });
		let item;
		let source;
		let isNew = false;
		if (found) {
			item = index.findReference(found.reference, found.eprintId);
			if (!item) {
				const context = { libraryID: options.libraryID, collectionIDs: await this.#targets(entry, options, filing), eprintKey: this.eprintKey() };
				item = found.record
					? await createItemFromRecord(this.Zotero, found.record, context)
					: await createItemFromEprintPaper(this.Zotero, found.paper, context);
				isNew = true;
				source = found.source;
			}
		}
		else if (entry.doi) {
			// Zotero's DOI lookup saves the item itself, so the duplicate check follows afterwards.
			const translated = await this.#translateDOI(entry.doi, await this.#targets(entry, options, filing), options);
			if (!translated) return notFound();
			item = index.findPaper(translated);
			if (item) {
				await this.Zotero.Items.trashTx([translated.id]);
			}
			else {
				item = translated;
				isNew = true;
				source = "DOI lookup";
			}
		}
		else {
			return notFound();
		}
		if (isNew) {
			index.addPaper(item);
			this.#claim(item, item.getCollections(), filing);
		}
		// An existing paper is filed in its queue, so that its collections are
		// never saved while another entry's work on the same item still runs.
		return {
			work: perItem(item.id, async () => (isNew
				? this.#processNew(item, source, options)
				: this.#updateExisting(item, await this.#file(item, entry, options, filing), options))),
		};
	}

	/**
	 * The collections an entry goes into: those of its sections (created when
	 * missing), or the target collection.
	 * @returns {Promise<number[]>}
	 */
	async #targets(entry, options, { collections, basePath }) {
		if (!entry.collections) return options.collectionID ? [options.collectionID] : [];
		const ids = [];
		for (const path of entry.collections) {
			const id = await collections.resolve(relativeCollectionPath(path, basePath));
			if (id && !ids.includes(id)) ids.push(id);
		}
		return ids;
	}

	/** Records the collections this run filed an item into. */
	#claim(item, collectionIDs, { claims }) {
		const claimed = claims.get(item.id) ?? new Set();
		for (const id of collectionIDs) claimed.add(id);
		claims.set(item.id, claimed);
		return claimed;
	}

	/**
	 * Puts a paper that is already in the library into the entry's collections
	 * and, when reorganizing, takes it out of the other collections below the
	 * target, except those this run filed it into for another entry (a paper
	 * listed in two sections stays in both).
	 * @returns {Promise<{ added: number[], removed: number[], refiledTo?: number } | null>} null if nothing changed
	 */
	async #file(item, entry, options, filing) {
		if (item.parentItemID) return null;
		const targets = await this.#targets(entry, options, filing);
		const claimed = this.#claim(item, targets, filing);
		const added = targets.filter((id) => !item.inCollection(id));
		const removed = item.getCollections().filter((id) => filing.subtree.has(id) && !claimed.has(id));
		if (!added.length && !removed.length) return null;
		for (const id of added) item.addToCollection(id);
		for (const id of removed) item.removeFromCollection(id);
		await item.saveTx();
		// Its files may follow only if no collection outside the target still holds the paper.
		const elsewhere = item.getCollections().some((id) => !filing.subtree.has(id));
		return { added, removed, refiledTo: removed.length && !elsewhere ? targets[0] : undefined };
	}

	/** A newly created item: CryptoBib update and ePrint PDF. */
	async #processNew(item, source, options) {
		const detail = await this.#runActions(item, [...options.metadataActions, ...options.eprintActions]);
		return /** @type {ListResult} */ ({ status: "added", item, detail: [source, detail].filter(Boolean).join(" · ") });
	}

	/**
	 * An entry whose paper is already in the library: only its ePrint PDF may be
	 * missing. Its collections were set while placing it.
	 */
	async #updateExisting(item, filed, options) {
		const detail = await this.#runActions(item, options.eprintActions);
		const where = filed ? this.#describeFiling(filed, options) : undefined;
		/** @type {ListResult} */
		const result = {
			status: filed?.removed.length ? "moved" : detail ? "updated" : "exists",
			item,
			detail: [where, detail].filter(Boolean).join(" \u00b7 ") || undefined,
		};
		if (filed?.refiledTo) result.refiledTo = filed.refiledTo;
		return result;
	}

	/**
	 * "moved from “A” to “B”" or "added to “B”"; nothing for the plain case of a
	 * paper added to the target collection, which the status already says.
	 */
	#describeFiling({ added, removed }, options) {
		if (!removed.length && added.every((id) => id === options.collectionID)) return undefined;
		const paths = new CollectionPaths(this.Zotero, options.libraryID, options.collectionID);
		const names = (ids) => ids.map((id) => `\u201c${paths.displayName(id)}\u201d`).join(", ");
		if (!removed.length) return `added to ${names(added)}`;
		return added.length ? `moved from ${names(removed)} to ${names(added)}` : `removed from ${names(removed)}`;
	}

	/** @returns {Promise<string | undefined>} details of the actions that changed something */
	async #runActions(item, actions) {
		if (!actions.length) return undefined;
		const [{ results } = { results: [] }] = await this.pipeline.run([item], actions);
		const detail = results.filter((r) => r.status === "changed" || r.status === "failed")
			.map((r) => r.detail).filter(Boolean).join(" \u00b7 ");
		return detail || undefined;
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

	async #translateDOI(doi, collectionIDs, options) {
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
				collections: collectionIDs,
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
