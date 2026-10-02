/**
 * Progress reporting. A reporter (BatchProgress and its subclasses) turns the
 * results of a run into rows and counts; a view shows them:
 *
 * - {@link DialogView}: a window of its own (content/progress.xhtml) for long
 *   runs, with a scrollable list of papers, a progress bar and Stop / Close;
 * - {@link ToastView}: Zotero's small progress pop-up, for short messages and
 *   as a fallback when the window cannot be opened.
 */
import { ASSETS, chromeURL, PROGRESS, TIMING } from "../config.js";

/**
 * @typedef {object} ProgressRow
 * @property {string} itemType  Zotero item type (icon in the pop-up).
 * @property {string} title
 * @property {string} status
 * @property {string} [detail]
 * @property {"ok" | "minor" | "error"} kind  "minor": nothing happened (e.g. already in the library).
 */

/**
 * @typedef {object} ProgressView
 * @property {boolean} stopRequested
 * @property {(headline: string) => void} open
 * @property {(text: string) => void} status
 * @property {(done: number, total: number) => void} progress
 * @property {(row: ProgressRow) => void} row
 * @property {(outcome?: { failed?: boolean, stopped?: boolean, message?: string }) => void} finish
 * @property {() => void} close
 */

/**
 * Zotero's small progress pop-up.
 * @implements {ProgressView}
 */
export class ToastView {
	#statusLine = null;
	#rows = 0;

	constructor(Zotero) {
		this.window = new Zotero.ProgressWindow({ closeOnClick: true });
	}

	get stopRequested() {
		return false;
	}

	open(headline) {
		this.window.changeHeadline(headline);
		this.window.show();
	}

	status(text) {
		this.#statusLine ??= new this.window.ItemProgress("", "");
		this.#statusLine.setText(text);
	}

	progress() {}

	/** @param {ProgressRow} row */
	row({ itemType, title, status, detail, kind }) {
		// The pop-up has room for a few lines only: problems and changes, not the rest.
		if (kind === "minor" || ++this.#rows > PROGRESS.maxItemLines) return;
		const line = new this.window.ItemProgress(itemType, `${title} — ${status}${detail ? `: ${detail}` : ""}`);
		if (kind === "error") line.setError();
		else line.setProgress(100);
	}

	/** @param {{ failed?: boolean, stopped?: boolean, message?: string }} [outcome] */
	finish({ failed = false, message = "" } = {}) {
		if (message) this.window.addDescription(message);
		this.window.startCloseTimer(TIMING.progressCloseDelayMs * (failed ? 2 : 1));
	}

	close() {
		this.window.close();
	}
}

/**
 * A window of its own for long runs. The window's script (content/progress.js)
 * renders `state` and subscribes to its changes. Closing the window does not
 * stop the run (its outcome then appears in a pop-up); its Stop button sets
 * `stopRequested`, which the run checks before starting each paper.
 * @implements {ProgressView}
 */
export class DialogView {
	/** @type {Set<(state: DialogView["state"], change?: { row?: ProgressRow }) => void>} */
	#listeners = new Set();
	#window = null;

	state = {
		headline: "",
		status: "",
		message: "",
		done: 0,
		total: 0,
		/** @type {ProgressRow[]} */
		rows: [],
		finished: false,
		failed: false,
		stopRequested: false,
	};

	/**
	 * @param {object} deps
	 * @param {any} deps.parentWindow  Window that opens the dialog.
	 * @param {Record<"stop" | "stopping" | "close" | "problemsOnly" | "noProblems" | "done" | "problems" | "stopped" | "failed", string>} deps.labels
	 *   The last four name the outcome shown when the run has finished.
	 * @param {() => ToastView} deps.fallback  Shows the outcome if the window was closed before the end.
	 */
	constructor({ parentWindow, labels, fallback }) {
		this.parentWindow = parentWindow;
		this.labels = labels;
		this.fallback = fallback;
	}

	get stopRequested() {
		return this.state.stopRequested;
	}

	/** Opens the window; throws if it cannot be opened. */
	open(headline) {
		this.state.headline = headline;
		this.#window = this.parentWindow.openDialog(chromeURL(ASSETS.progressDialog), "_blank",
			"chrome,dialog=no,resizable,centerscreen,width=680,height=520", this);
	}

	/** Called by the window: `listener(state, change)` after every change. */
	subscribe(listener) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Called by the window's Stop button. */
	requestStop() {
		if (this.state.finished || this.state.stopRequested) return;
		this.state.stopRequested = true;
		this.#emit();
	}

	status(text) {
		this.state.status = text;
		this.#emit();
	}

	progress(done, total) {
		Object.assign(this.state, { done, total });
		this.#emit();
	}

	/** @param {ProgressRow} row */
	row(row) {
		this.state.rows.push(row);
		this.#emit({ row });
	}

	/** @param {{ failed?: boolean, stopped?: boolean, message?: string }} [outcome] */
	finish({ failed = false, message = "" } = {}) {
		Object.assign(this.state, { finished: true, failed, message });
		this.#emit();
		if (!this.#window || this.#window.closed) {
			const toast = this.fallback();
			toast.open(this.state.headline);
			toast.status(this.state.status);
			toast.finish({ failed, message });
		}
	}

	close() {
		this.#window?.close();
	}

	#emit(change) {
		for (const listener of this.#listeners) {
			try {
				listener(this.state, change);
			}
			catch {
				// A window that went away without unsubscribing.
				this.#listeners.delete(listener);
			}
		}
	}
}

/**
 * Reports the progress of a pipeline run (menu commands).
 */
export class BatchProgress {
	done = 0;
	total = 0;

	/**
	 * @param {any} Zotero
	 * @param {import("./l10n.js").L10n} l10n
	 * @param {string} headlineId l10n id of the headline
	 * @param {ProgressView} [view] Opened here; Zotero's pop-up by default.
	 */
	constructor(Zotero, l10n, headlineId, view = new ToastView(Zotero)) {
		this.Zotero = Zotero;
		this.l10n = l10n;
		this.view = view;
		/** @type {Record<string, number>} */
		this.counts = { changed: 0, unchanged: 0, skipped: 0, failed: 0 };
		view.open(l10n.format(headlineId));
	}

	/** Whether the user asked to stop (the run then starts no new papers). */
	get stopRequested() {
		return this.view.stopRequested;
	}

	/** A message that is not about a single item (e.g. downloading CryptoBib). */
	status(localId, args) {
		this.view.status(this.l10n.format(localId, args));
	}

	setTotal(total) {
		this.total = total;
		this.view.progress(this.done, total);
	}

	/** @param {ProgressRow} row */
	addRow(row) {
		this.view.row(row);
		this.view.progress(++this.done, this.total);
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
		this.addRow({
			itemType: item.itemType,
			title: item.getDisplayTitle(),
			status: this.l10n.format(`status-${worst.status}`),
			detail: results.map((r) => r.detail).filter(Boolean).join(" · ") || undefined,
			kind: worst.status === "failed" ? "error" : worst.status === "changed" ? "ok" : "minor",
		});
	}

	/**
	 * Shows a final message (by default the per-status counts).
	 * @param {string} [localId]
	 * @param {Record<string, number>} [args]
	 */
	finish(localId = "progress-summary", args = this.counts) {
		this.status(localId, args);
		const stopped = this.view.stopRequested;
		this.view.finish({ stopped, message: stopped ? this.l10n.format("progress-stopped") : "" });
	}

	close() {
		this.view.close();
	}

	fail(error) {
		this.status("progress-failed");
		this.view.finish({ failed: true, message: String(error?.message ?? error) });
	}
}

/** Fluent-safe names for the list-import statuses. */
const LIST_COUNTS = Object.freeze({ added: "added", updated: "updated", moved: "moved", exists: "exists", "not-found": "notFound", failed: "failed" });

/**
 * Progress of adding the papers of a reading list: one row per paper and a
 * summary of the outcomes.
 */
export class ListProgress extends BatchProgress {
	/** @param {ProgressView} [view] */
	constructor(Zotero, l10n, view) {
		super(Zotero, l10n, "progress-add-list", view);
		this.counts = { added: 0, updated: 0, moved: 0, exists: 0, notFound: 0, failed: 0 };
	}

	/**
	 * @param {import("../core/list.js").ListEntry} entry
	 * @param {import("../zotero/list-import.js").ListResult} result
	 */
	entryDone(entry, result) {
		this.counts[LIST_COUNTS[result.status]]++;
		const problem = result.status === "failed" || result.status === "not-found";
		this.addRow({
			itemType: result.item?.itemType ?? "document",
			title: result.item?.getDisplayTitle?.() || entry.raw,
			status: this.l10n.format(`list-status-${result.status}`),
			detail: result.detail,
			kind: problem ? "error" : result.status === "exists" ? "minor" : "ok",
		});
	}

	finish() {
		super.finish("list-summary", this.counts);
	}
}

/**
 * Progress of a folder import: one row per file and a summary of the outcomes.
 */
export class FolderImportProgress extends BatchProgress {
	/** @param {ProgressView} [view] */
	constructor(Zotero, l10n, view) {
		super(Zotero, l10n, "progress-import-folder", view);
		this.counts = { imported: 0, attached: 0, exists: 0, repeat: 0, unrecognized: 0, failed: 0 };
	}

	/**
	 * @param {import("../zotero/folder-import.js").FolderFile} file
	 * @param {import("../zotero/folder-import.js").ImportResult} result
	 */
	fileDone(file, result) {
		this.counts[result.status]++;
		const title = result.item?.isRegularItem?.() ? result.item.getDisplayTitle() : file.name;
		this.addRow({
			itemType: "attachmentPDF",
			title,
			status: this.l10n.format(`import-status-${result.status}`),
			detail: result.detail,
			kind: result.status === "failed" ? "error" : result.status === "exists" || result.status === "repeat" ? "minor" : "ok",
		});
	}

	finish() {
		super.finish("import-summary", this.counts);
	}
}
