/**
 * What a library already contains, for the folder import: its PDF files (by
 * path, MD5 and size) and its papers (by DOI, ePrint id, and title + authors).
 */
import { bestMatch } from "../core/matching.js";
import { normalizeDOI } from "../core/text.js";
import { storedEprintId } from "./eprint.js";
import { ItemWrapper } from "./item.js";

/**
 * @typedef {object} PaperEntry
 * @property {any} item   Zotero.Item
 * @property {string} title
 * @property {string[]} authors
 * @property {number} [year]
 * @property {string} [doi]
 * @property {string | null} eprintId
 */

export class LibraryIndex {
	/** @type {PaperEntry[]} */ #papers = [];
	/** @type {Map<string, PaperEntry>} */ #byDOI = new Map();
	/** @type {Map<string, PaperEntry>} */ #byEprint = new Map();
	/** @type {Map<string, any>} path → attachment */ #byPath = new Map();
	/** @type {Map<string, any>} MD5 → attachment */ #byHash = new Map();
	/** @type {Map<number, Array<{ path: string, attachment: any }>>} */ #bySize = new Map();
	/** @type {Map<string, Promise<string | false>>} */ #md5 = new Map();

	/**
	 * @param {object} deps
	 * @param {any} deps.Zotero
	 * @param {import("./platform.js").FileStore} deps.files
	 * @param {string} deps.eprintKey Extra-field key of the ePrint id.
	 */
	constructor({ Zotero, files, eprintKey }) {
		this.Zotero = Zotero;
		this.files = files;
		this.eprintKey = eprintKey;
	}

	/**
	 * Indexes every regular item and PDF attachment of a library (trash excluded).
	 * @param {number} libraryID
	 * @param {{ files?: boolean }} [options] files: false skips the attachments,
	 *   for callers that only use {@link findPaper} / {@link findReference}.
	 */
	async load(libraryID, { files = true } = {}) {
		const items = await this.Zotero.Items.getAll(libraryID, false, false);
		for (const item of items) {
			if (item.deleted) continue;
			if (item.isRegularItem()) this.addPaper(item);
			else if (files && item.isFileAttachment?.() && item.isPDFAttachment?.()) await this.#addAttachment(item);
		}
		return this;
	}

	async #addAttachment(attachment) {
		const hash = attachment.attachmentSyncedHash;
		if (hash) this.#byHash.set(hash, attachment);
		const path = attachment.getFilePath();
		if (!path) return;
		this.#byPath.set(path, attachment);
		const stat = await this.files.stat(path).catch(() => null);
		if (!stat) return;
		const list = this.#bySize.get(stat.size) ?? [];
		list.push({ path, attachment });
		this.#bySize.set(stat.size, list);
	}

	/** MD5 of a file, computed once. */
	md5(path) {
		if (!this.#md5.has(path)) this.#md5.set(path, this.files.md5(path));
		return this.#md5.get(path);
	}

	/**
	 * The attachment holding this exact file (same path, or same content).
	 * @param {{ path: string, size: number }} file
	 */
	async findFile({ path, size }) {
		const linked = this.#byPath.get(path);
		if (linked) return linked;
		const hash = await this.md5(path);
		if (!hash) return null;
		const synced = this.#byHash.get(hash);
		if (synced) return synced;
		for (const entry of this.#bySize.get(size) ?? []) {
			if ((await this.md5(entry.path)) === hash) return entry.attachment;
		}
		return null;
	}

	/** Adds a regular item, e.g. one imported earlier in the same run. */
	addPaper(item) {
		const wrapper = new ItemWrapper(item, this.Zotero);
		const entry = { item, ...wrapper.reference, eprintId: storedEprintId(wrapper, this.eprintKey) };
		this.#papers.push(entry);
		if (entry.doi) this.#byDOI.set(entry.doi, entry);
		if (entry.eprintId) this.#byEprint.set(entry.eprintId, entry);
	}

	/**
	 * The library item describing the same paper as `item`, if any: same DOI,
	 * same ePrint id, or matching title and authors. Items whose DOIs differ are
	 * different publications (e.g. conference and journal version).
	 * @param {any} item Zotero.Item
	 * @returns {any | null}
	 */
	findPaper(item) {
		const wrapper = new ItemWrapper(item, this.Zotero);
		return this.findReference(wrapper.reference, storedEprintId(wrapper, this.eprintKey), item.id);
	}

	/**
	 * The library item describing the same paper as a reference from another
	 * source (a CryptoBib record, an ePrint page).
	 * @param {import("../core/matching.js").Reference} reference
	 * @param {string | null} [eprintId]
	 * @param {number} [excludeItemID]
	 * @returns {any | null}
	 */
	findReference(reference, eprintId = null, excludeItemID = undefined) {
		const doi = normalizeDOI(reference.doi);
		const isOther = (entry) => entry.item.id !== excludeItemID;
		const byDOI = doi && this.#byDOI.get(doi);
		if (byDOI && isOther(byDOI)) return byDOI.item;
		const byEprint = eprintId && this.#byEprint.get(eprintId);
		if (byEprint && isOther(byEprint)) return byEprint.item;
		const candidates = this.#papers.filter((entry) => isOther(entry) && !(doi && entry.doi && entry.doi !== doi));
		return bestMatch(reference, candidates)?.candidate.item ?? null;
	}

	/** Whether the item has a PDF attachment. */
	hasPDF(item) {
		return this.Zotero.Items.get(item.getAttachments()).some((a) => a.isPDFAttachment?.());
	}
}
