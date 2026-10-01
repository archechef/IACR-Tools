/**
 * Reports the progress of a pipeline run in a Zotero progress window.
 */
import { PROGRESS, TIMING } from "../config.js";

export class BatchProgress {
	/** @type {any} Line used for messages that are not about a single item. */
	statusLine = null;
	itemLines = 0;

	/**
	 * @param {any} Zotero
	 * @param {import("./l10n.js").L10n} l10n
	 * @param {string} headlineId l10n id of the headline
	 */
	constructor(Zotero, l10n, headlineId) {
		this.Zotero = Zotero;
		this.l10n = l10n;
		/** @type {Record<string, number>} */
		this.counts = { changed: 0, unchanged: 0, skipped: 0, failed: 0 };
		this.window = new Zotero.ProgressWindow({ closeOnClick: true });
		this.window.changeHeadline(l10n.format(headlineId));
		this.window.show();
	}

	/** A progress line for work that is not tied to an item (e.g. downloading CryptoBib). */
	status(localId, args) {
		this.statusLine ??= new this.window.ItemProgress("", "");
		this.statusLine.setText(this.l10n.format(localId, args));
	}

	/**
	 * @param {any} item
	 * @param {import("../zotero/pipeline.js").ActionResult[]} results
	 */
	itemDone(item, results) {
		const worst = results.find((r) => r.status === "failed")
			?? results.find((r) => r.status === "changed")
			?? results.at(-1);
		this.counts[worst.status]++;
		if (++this.itemLines > PROGRESS.maxItemLines) return;
		const details = results.map((r) => r.detail).filter(Boolean).join(" · ");
		const line = new this.window.ItemProgress(item.itemType,
			`${item.getDisplayTitle()} — ${this.l10n.format(`status-${worst.status}`)}${details ? `: ${details}` : ""}`);
		if (worst.status === "failed") line.setError();
		else line.setProgress(100);
	}

	/**
	 * Shows a final message (by default the per-status counts) and closes after a delay.
	 * @param {string} [localId]
	 * @param {Record<string, number>} [args]
	 */
	finish(localId = "progress-summary", args = this.counts) {
		this.status(localId, args);
		this.window.startCloseTimer(TIMING.progressCloseDelayMs);
	}

	close() {
		this.window.close();
	}

	fail(error) {
		this.status("progress-failed");
		this.window.addDescription(String(error?.message ?? error));
		this.window.startCloseTimer(TIMING.progressCloseDelayMs * 2);
	}
}

/** Fluent-safe names for the list-import statuses. */
const LIST_COUNTS = Object.freeze({ added: "added", updated: "updated", exists: "exists", "not-found": "notFound", failed: "failed" });

/**
 * Progress of adding the papers of a reading list: one line per paper and a
 * summary of the outcomes.
 */
export class ListProgress extends BatchProgress {
	constructor(Zotero, l10n) {
		super(Zotero, l10n, "progress-add-list");
		this.counts = { added: 0, updated: 0, exists: 0, notFound: 0, failed: 0 };
	}

	/**
	 * @param {import("../core/list.js").ListEntry} entry
	 * @param {import("../zotero/list-import.js").ListResult} result
	 */
	entryDone(entry, result) {
		this.counts[LIST_COUNTS[result.status]]++;
		if (++this.itemLines > PROGRESS.maxItemLines) return;
		const title = result.item?.getDisplayTitle?.() || entry.raw;
		const status = this.l10n.format(`list-status-${result.status}`);
		const line = new this.window.ItemProgress(result.item?.itemType ?? "document",
			`${title} \u2014 ${status}${result.detail ? `: ${result.detail}` : ""}`);
		if (result.status === "failed" || result.status === "not-found") line.setError();
		else line.setProgress(100);
	}

	finish() {
		super.finish("list-summary", this.counts);
	}
}

/**
 * Progress of a folder import: one line per file (up to a limit) and a summary
 * of the outcomes.
 */
export class FolderImportProgress extends BatchProgress {
	constructor(Zotero, l10n) {
		super(Zotero, l10n, "progress-import-folder");
		this.counts = { imported: 0, attached: 0, exists: 0, repeat: 0, unrecognized: 0, failed: 0 };
	}

	/**
	 * @param {import("../zotero/folder-import.js").FolderFile} file
	 * @param {import("../zotero/folder-import.js").ImportResult} result
	 */
	fileDone(file, result) {
		this.counts[result.status]++;
		if (result.status === "exists" || result.status === "repeat") return;
		if (++this.itemLines > PROGRESS.maxItemLines) return;
		const title = result.item?.isRegularItem?.() ? result.item.getDisplayTitle() : file.name;
		const status = this.l10n.format(`import-status-${result.status}`);
		const line = new this.window.ItemProgress("attachmentPDF", `${title} — ${status}${result.detail ? `: ${result.detail}` : ""}`);
		if (result.status === "failed") line.setError();
		else line.setProgress(100);
	}

	finish() {
		super.finish("import-summary", this.counts);
	}
}
