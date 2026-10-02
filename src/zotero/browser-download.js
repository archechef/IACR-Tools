/**
 * Downloads in the user's own browser, for publishers that turn away programs
 * (ACM's Digital Library answers every request that is not a person's browser
 * with a Cloudflare check). The links are opened in the browser, a few at a
 * time; the user saves each PDF as usual, and every new PDF that appears in
 * the Downloads folder is attached to its paper. Nothing here gets past such
 * a check by itself: the browser and the person at it do.
 *
 * A new file belongs to the paper its name names (DOI or title, see
 * core/downloads.js) or, when it names none, to the only paper whose link is
 * open at that moment; otherwise it is reported and left alone.
 */
import { BROWSER_DOWNLOAD } from "../config.js";
import { browserPdfURL, paperForFileName } from "../core/downloads.js";

/**
 * @typedef {object} BrowserPaper
 * @property {any} item  The Zotero item.
 * @property {string} doi
 * @property {string} title
 */

/**
 * @typedef {object} BrowserDownloadHooks
 * @property {(paper: BrowserPaper, fileName: string) => void} [onAttached]
 * @property {(fileName: string) => void} [onUnmatched]
 * @property {(paper: BrowserPaper, error: any) => void} [onFailed]
 * @property {(waiting: number) => void} [onWaiting]  Papers still waited for, after each change.
 * @property {() => boolean} [shouldStop]
 */

export class BrowserDownloads {
	/**
	 * @param {object} deps
	 * @param {any} deps.Zotero
	 * @param {import("./platform.js").FileStore} deps.files
	 * @param {{ setTimeout: Function }} deps.timers
	 * @param {(url: string) => void} deps.openURL  Opens a link in the user's browser.
	 * @param {(msg: string) => void} deps.log
	 * @param {() => number} [deps.now]
	 */
	constructor({ Zotero, files, timers, openURL, log, now = () => Date.now() }) {
		this.Zotero = Zotero;
		this.files = files;
		this.timers = timers;
		this.openURL = openURL;
		this.log = log;
		this.now = now;
	}

	/**
	 * Opens the papers' links and attaches the PDFs that arrive in `folder`,
	 * until every paper has one, the user stops, or nothing arrives for a while.
	 * @param {BrowserPaper[]} papers
	 * @param {string} folder
	 * @param {BrowserDownloadHooks} [hooks]
	 * @returns {Promise<{ attached: BrowserPaper[], missing: BrowserPaper[], unmatched: string[] }>}
	 */
	async run(papers, folder, { onAttached = () => {}, onUnmatched = () => {}, onFailed = () => {}, onWaiting = () => {}, shouldStop = () => false } = {}) {
		const queue = [...papers];
		/** @type {BrowserPaper[]} */
		const open = [];
		const attached = [];
		const unmatched = [];
		// Files already there are not downloads of this run.
		/** @type {Map<string, number | null>} size at the last look; null: dealt with */
		const seen = new Map((await this.#pdfsIn(folder)).map((path) => [path, null]));
		let lastActivity = this.now();

		const openMore = () => {
			while (open.length < BROWSER_DOWNLOAD.maxOpen && queue.length) {
				const paper = queue.shift();
				open.push(paper);
				this.openURL(browserPdfURL(paper.doi));
			}
			onWaiting(open.length + queue.length);
		};
		openMore();

		while (open.length && !shouldStop() && this.now() - lastActivity < BROWSER_DOWNLOAD.idleTimeoutMs) {
			await new Promise((resolve) => this.timers.setTimeout(resolve, BROWSER_DOWNLOAD.pollMs));
			for (const path of await this.#pdfsIn(folder)) {
				if (!(await this.#isComplete(path, seen))) continue;
				lastActivity = this.now();
				const fileName = this.files.basename(path);
				const paper = paperForFileName(fileName, [...open, ...queue]) ?? (open.length === 1 ? open[0] : null);
				if (!paper) {
					unmatched.push(fileName);
					onUnmatched(fileName);
					continue;
				}
				for (const list of [open, queue]) {
					const index = list.indexOf(paper);
					if (index >= 0) list.splice(index, 1);
				}
				try {
					await this.#attach(paper.item, path);
					attached.push(paper);
					onAttached(paper, fileName);
				}
				catch (e) {
					this.log(`Attaching ${path} failed: ${e}`);
					onFailed(paper, e);
				}
				openMore();
				if (!open.length) break;
			}
		}
		return { attached, missing: [...open, ...queue], unmatched };
	}

	/**
	 * A new PDF counts once its size has stayed the same between two looks
	 * (browsers write under a temporary name, but some copy in place).
	 */
	async #isComplete(path, seen) {
		const before = seen.get(path);
		if (before === null) return false;
		let size;
		try {
			({ size } = await this.files.stat(path));
		}
		catch {
			return false;
		}
		seen.set(path, size);
		if (before === undefined || before !== size || size === 0) return false;
		seen.set(path, null);
		return true;
	}

	async #pdfsIn(folder) {
		const children = await this.files.children(folder);
		return children.filter((path) => /\.pdf$/i.test(path));
	}

	/** A copy of the file becomes the paper's PDF, named as Zotero names files (if it renames them). */
	async #attach(item, path) {
		const { Attachments } = this.Zotero;
		const rename = Attachments.shouldAutoRenameFile?.(false, item.libraryID)
			&& Attachments.isRenameAllowedForType?.("application/pdf", item.libraryID);
		return Attachments.importFromFile({
			file: path,
			parentItemID: item.id,
			...(rename ? { fileBaseName: Attachments.getFileBaseNameFromItem(item) } : {}),
		});
	}
}
