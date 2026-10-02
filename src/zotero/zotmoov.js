/**
 * Lets ZotMoov (another plugin) move the files of papers that a list import
 * moved between collections. ZotMoov files a PDF in a folder per collection
 * when it is added, but never moves it again when the paper changes
 * collection; this asks it to, with the paper's new collection as the one
 * whose folder counts.
 *
 * ZotMoov's own "Move Selected to Directory" does the same, using its
 * settings; this calls the methods behind it (`move`, `getBasePrefs`) and does
 * nothing when they are missing or ZotMoov is set to copy files.
 */
import { ZOTMOOV } from "../config.js";

export class ZotMoovFiles {
	/**
	 * @param {object} deps
	 * @param {any} deps.Zotero
	 * @param {(msg: string) => void} deps.log
	 */
	constructor({ Zotero, log }) {
		this.Zotero = Zotero;
		this.log = log;
	}

	/** ZotMoov is installed, moves files (not copies) and sorts them into collection folders. */
	get available() {
		const { Zotero } = this;
		const zotmoov = Zotero.ZotMoov;
		const pref = (key) => Zotero.Prefs.get(key, true);
		return typeof zotmoov?.move === "function" && typeof zotmoov.getBasePrefs === "function"
			&& Boolean(pref(ZOTMOOV.prefs.directory))
			&& pref(ZOTMOOV.prefs.fileBehavior) === ZOTMOOV.moveBehavior
			&& Boolean(pref(ZOTMOOV.prefs.subdirectories));
	}

	/**
	 * Moves the files ZotMoov already manages (linked files) of each paper into
	 * the folder of its new collection. Stored files are left alone: ZotMoov
	 * picks up new ones itself, and moving them here as well would race it.
	 * @param {Array<{ item: any, collectionID: number }>} papers
	 * @returns {Promise<number>} attachments handed to ZotMoov
	 */
	async moveFiles(papers) {
		if (!papers.length || !this.available) return 0;
		const { Zotero } = this;
		const zotmoov = Zotero.ZotMoov;
		const directory = Zotero.Prefs.get(ZOTMOOV.prefs.directory, true);
		const linked = Zotero.Attachments.LINK_MODE_LINKED_FILE;
		let count = 0;
		for (const { item, collectionID } of papers) {
			const attachments = Zotero.Items.get(item.getAttachments())
				.filter((attachment) => attachment.isFileAttachment() && attachment.attachmentLinkMode === linked);
			if (!attachments.length) continue;
			try {
				await zotmoov.move(attachments, directory, { ...zotmoov.getBasePrefs(), preferred_collection: collectionID });
				count += attachments.length;
			}
			catch (e) {
				this.log(`ZotMoov could not move the files of item ${item.id}: ${e}`);
			}
		}
		return count;
	}
}
