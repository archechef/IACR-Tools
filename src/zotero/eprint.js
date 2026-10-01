/**
 * Actions that find the IACR ePrint version of an item, record its id and
 * download its PDF.
 *
 * Zotero has no user-defined fields, so the id is stored as a
 * "IACR ePrint: YYYY/NNN" line in Extra (the key is a preference). A custom
 * item-tree column displays it like a regular field.
 */
import { EPRINT } from "../config.js";
import { eprintPageURL, eprintPdfURL, parseEprintId } from "../core/eprint.js";
import { result } from "./pipeline.js";

/**
 * Reads the stored ePrint id, falling back to the URL / archive id of items
 * that are themselves ePrint preprints.
 * @param {import("./item.js").ItemWrapper} item
 * @param {string} extraKey
 */
export function storedEprintId(item, extraKey) {
	const stored = parseEprintId(item.getExtra(extraKey) ?? "");
	if (stored || item.itemType !== EPRINT.itemType) return stored;
	return parseEprintId(item.getField("url")) ?? parseEprintId(item.getField("archiveID"));
}

export class EprintActions {
	/**
	 * @param {object} deps
	 * @param {any} deps.Zotero
	 * @param {import("./prefs.js").Prefs} deps.prefs
	 * @param {import("./eprint-sources.js").EprintFinder} deps.finder
	 */
	constructor({ Zotero, prefs, finder }) {
		this.Zotero = Zotero;
		this.prefs = prefs;
		this.finder = finder;

		/** @type {import("./pipeline.js").Action} */
		this.find = Object.freeze({ id: "find-eprint", run: (context) => this.#find(context) });
		/** @type {import("./pipeline.js").Action} */
		this.download = Object.freeze({ id: "download-eprint", run: (context) => this.#download(context) });
	}

	get #extraKey() {
		return String(this.prefs.get("eprintExtraKey"));
	}

	/** Resolves (and stores) the ePrint id once per pipeline run. */
	#resolveId(context) {
		return context.memo("eprintId", async () => {
			const { item } = context;
			const stored = storedEprintId(item, this.#extraKey);
			if (stored) return { id: stored, isNew: !item.getExtra(this.#extraKey) };
			const hit = await this.finder.find(item.reference);
			return hit ? { id: hit.id, isNew: true, source: hit.source } : null;
		});
	}

	async #find(context) {
		const found = await this.#resolveId(context);
		if (!found) return result.unchanged("no ePrint version found");
		if (!found.isNew) return result.unchanged(found.id);
		context.item.setExtra(this.#extraKey, found.id);
		await context.item.save();
		return result.changed(found.source ? `${found.id} (${found.source})` : found.id);
	}

	async #download(context) {
		const findResult = await this.#find(context);
		const found = await this.#resolveId(context);
		if (!found) return findResult;
		const { item } = context.item;
		const pdfURL = eprintPdfURL(found.id);
		if (this.#hasAttachment(item, [pdfURL, eprintPageURL(found.id)])) {
			return result.unchanged(`${found.id}: PDF already attached`);
		}
		await this.Zotero.Attachments.importFromURL({
			libraryID: item.libraryID,
			parentItemID: item.id,
			url: pdfURL,
			title: EPRINT.attachmentTitle,
			contentType: EPRINT.pdfContentType,
		});
		return result.changed(found.id);
	}

	#hasAttachment(item, urls) {
		return this.Zotero.Items.get(item.getAttachments())
			.some((attachment) => urls.includes(attachment.getField("url")));
	}
}
