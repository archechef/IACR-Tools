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
import { eprintRevisionTime } from "../core/eprint-page.js";
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
	 * @param {import("./platform.js").Http} [deps.http]  For the revision check.
	 * @param {(path: string) => Promise<string | false>} [deps.md5]  For the revision check.
	 */
	constructor({ Zotero, prefs, finder, http, md5 = async () => false }) {
		this.Zotero = Zotero;
		this.prefs = prefs;
		this.finder = finder;
		this.http = http;
		this.md5 = md5;

		/** @type {import("./pipeline.js").Action} */
		this.find = Object.freeze({ id: "find-eprint", run: (context) => this.#find(context) });
		/** @type {import("./pipeline.js").Action} */
		this.download = Object.freeze({ id: "download-eprint", run: (context) => this.#download(context) });
		/** @type {import("./pipeline.js").Action} */
		this.checkRevision = Object.freeze({ id: "check-eprint-revision", run: (context) => this.#checkRevision(context) });
	}

	get #extraKey() {
		return String(this.prefs.get("eprintExtraKey"));
	}

	/**
	 * The item's ePrint id, stored or looked up (once per pipeline run, shared
	 * with the other actions of the item), without storing it.
	 * @returns {Promise<string | null>}
	 */
	async eprintIdOf(context) {
		return (await this.#resolveId(context))?.id ?? null;
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
		return this.#attachments(item, urls).length > 0;
	}

	/** The item's attachments downloaded from one of the URLs (not in the trash). */
	#attachments(item, urls) {
		return this.Zotero.Items.get(item.getAttachments())
			.filter((attachment) => !attachment.deleted && urls.includes(attachment.getField("url")));
	}

	/**
	 * Fetches the ePrint PDF again when the paper was revised after the
	 * attached copy: the page's article:modified_time is compared with the
	 * revision recorded in Extra ("<key> version: …") or, failing that, with
	 * when the PDF was attached. A download that turns out identical is
	 * discarded. The older PDF is kept under a dated title, or moved to the
	 * trash when the preference says so.
	 */
	async #checkRevision(context) {
		const { item } = context;
		const id = storedEprintId(item, this.#extraKey);
		if (!id) return result.skipped("no ePrint id");
		const parent = item.item;
		const pdfURL = eprintPdfURL(id);
		const current = this.#attachments(parent, [pdfURL, eprintPageURL(id)])
			.filter((attachment) => !EPRINT.olderAttachmentTitlePattern.test(attachment.getField("title")))
			.sort((a, b) => attachmentTime(b) - attachmentTime(a));
		if (!current.length) return result.skipped(`${id}: no ePrint PDF attached`);

		const revised = eprintRevisionTime(await this.http.getDocument(eprintPageURL(id)));
		if (!revised) return result.unchanged(`${id}: revision date unknown`);
		const versionKey = EPRINT.versionKey(this.#extraKey);
		const recorded = item.getExtra(versionKey);
		const known = recorded ? Date.parse(recorded) : attachmentTime(current[0]);
		if (Number.isFinite(known) && Date.parse(revised) <= known) return result.unchanged(`${id}: up to date`);

		const fresh = await this.Zotero.Attachments.importFromURL({
			libraryID: parent.libraryID,
			parentItemID: parent.id,
			url: pdfURL,
			title: EPRINT.attachmentTitle,
			contentType: EPRINT.pdfContentType,
		});
		item.setExtra(versionKey, revised);
		const day = revised.slice(0, 10);
		if (await this.#sameFile(fresh, current[0])) {
			await this.Zotero.Items.trashTx([fresh.id]);
			await item.save();
			return result.unchanged(`${id}: revised ${day}, but the PDF is the same`);
		}
		if (this.prefs.get("replaceRevisedEprint")) {
			await this.Zotero.Items.trashTx(current.map((attachment) => attachment.id));
		}
		else {
			const oldDay = recorded?.slice(0, 10) || isoDay(attachmentTime(current[0]));
			for (const attachment of current) {
				attachment.setField("title", EPRINT.olderAttachmentTitle(oldDay));
				await attachment.saveTx();
			}
		}
		await item.save();
		return result.changed(`${id}: revised version of ${day}`);
	}

	async #sameFile(a, b) {
		const [x, y] = await Promise.all([a, b].map((attachment) => {
			const path = attachment.getFilePath?.();
			return path ? this.md5(path) : false;
		}));
		return Boolean(x) && x === y;
	}
}

/** When an attachment was added (Zotero stores "YYYY-MM-DD HH:MM:SS" in UTC). */
function attachmentTime(attachment) {
	const added = attachment.dateAdded;
	return added ? Date.parse(`${added.replace(" ", "T")}Z`) : Number.NaN;
}

/** "2024-05-03" for a time in milliseconds; "" if unknown. */
function isoDay(time) {
	return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : "";
}
