/**
 * Runs the enabled actions on newly added items (e.g. right after saving a
 * paper from Springer Link with the Zotero Connector).
 */
import { AUTO, PLUGIN } from "../config.js";

export class AutoProcessor {
	#observerID = null;
	#pending = new Set();
	#timer = null;
	#running = Promise.resolve();
	#suspended = 0;

	/**
	 * @param {object} deps
	 * @param {any} deps.Zotero
	 * @param {import("./pipeline.js").Pipeline} deps.pipeline
	 * @param {() => import("./pipeline.js").Action[]} deps.enabledActions
	 * @param {{ setTimeout: Function, clearTimeout: Function }} deps.timers
	 * @param {(msg: string) => void} deps.log
	 */
	constructor({ Zotero, pipeline, enabledActions, timers, log }) {
		this.Zotero = Zotero;
		this.pipeline = pipeline;
		this.enabledActions = enabledActions;
		this.timers = timers;
		this.log = log;
	}

	start() {
		this.#observerID = this.Zotero.Notifier.registerObserver(
			{ notify: (event, type, ids) => this.#onNotify(event, ids) },
			["item"],
			PLUGIN.l10nPrefix,
		);
	}

	stop() {
		if (this.#observerID) this.Zotero.Notifier.unregisterObserver(this.#observerID);
		this.#observerID = null;
		this.timers.clearTimeout(this.#timer);
		this.#pending.clear();
	}

	/**
	 * Ignores new items until the returned function is called, e.g. while the
	 * folder import adds items that it processes itself.
	 * @returns {() => void}
	 */
	suspend() {
		this.#suspended++;
		let resumed = false;
		return () => {
			if (!resumed) this.#suspended--;
			resumed = true;
		};
	}

	#onNotify(event, ids) {
		if (event !== "add" || this.#suspended || !this.enabledActions().length) return;
		for (const id of ids) this.#pending.add(id);
		// Debounce: translators save the item first and its attachments/notes afterwards.
		this.timers.clearTimeout(this.#timer);
		this.#timer = this.timers.setTimeout(() => {
			this.#running = this.#running
				.then(() => this.#flush())
				.catch((e) => this.log(`Automatic processing failed: ${e}`));
		}, AUTO.delayMs);
	}

	/** Resolves when all scheduled processing has finished. */
	whenIdle() {
		return this.#running;
	}

	async #flush() {
		const ids = [...this.#pending];
		this.#pending.clear();
		if (ids.length > AUTO.maxItemsPerBatch) {
			this.log(`Skipping automatic processing of ${ids.length} items (batch too large)`);
			return;
		}
		// Items downloaded by sync were already processed on the machine that created them.
		const items = this.Zotero.Items.get(ids).filter((item) => item && !item.deleted && !item.synced);
		if (!items.length) return;
		const summary = await this.pipeline.run(items, this.enabledActions());
		for (const { item, results } of summary) {
			this.log(`Auto-processed ${item.key}: ${results.map((r) => `${r.status}${r.detail ? ` (${r.detail})` : ""}`).join(", ")}`);
		}
	}
}
