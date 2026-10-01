/**
 * The action framework shared by menu commands and automatic processing.
 *
 * An {@link Action} performs one kind of edit on one item. A {@link Pipeline}
 * runs a list of actions over many items, sharing an {@link ItemContext} per
 * item so that expensive lookups (e.g. the CryptoBib match) happen once.
 */
import { mapConcurrent } from "../core/concurrency.js";
import { ItemWrapper } from "./item.js";

/**
 * @typedef {"changed" | "unchanged" | "skipped" | "failed"} ActionStatus
 * @typedef {{ status: ActionStatus, detail?: string }} ActionResult
 */

/**
 * @typedef {object} Action
 * @property {string} id           Stable identifier, also used for l10n ids.
 * @property {(ctx: ItemContext) => Promise<ActionResult>} run
 */

/** @type {(status: ActionStatus) => (detail?: string) => ActionResult} */
const resultOf = (status) => (detail) => ({ status, detail });

export const result = Object.freeze({
	changed: resultOf("changed"),
	unchanged: resultOf("unchanged"),
	skipped: resultOf("skipped"),
	failed: resultOf("failed"),
});

/** Per-item state shared by the actions of one pipeline run. */
export class ItemContext {
	#memo = new Map();

	/**
	 * @param {ItemWrapper} item
	 * @param {import("./cryptobib-store.js").CryptoBibStore} store
	 */
	constructor(item, store) {
		this.item = item;
		this.store = store;
	}

	/** Memoizes an async computation for the lifetime of this context. */
	memo(key, compute) {
		if (!this.#memo.has(key)) this.#memo.set(key, compute());
		return this.#memo.get(key);
	}

	/** The CryptoBib publication matching this item (computed once). */
	publicationMatch() {
		return this.memo("publicationMatch", async () => {
			const index = await this.store.getIndex();
			return index.findPublication(this.item.reference);
		});
	}
}

export class Pipeline {
	/**
	 * @param {object} deps
	 * @param {any} deps.Zotero
	 * @param {import("./cryptobib-store.js").CryptoBibStore} deps.store
	 * @param {(msg: string) => void} deps.log
	 */
	constructor({ Zotero, store, log }) {
		this.Zotero = Zotero;
		this.store = store;
		this.log = log;
	}

	/** Regular items in editable libraries. */
	eligible(items) {
		return items.filter((item) => item.isRegularItem() && this.Zotero.Libraries.isEditable(item.libraryID));
	}

	/**
	 * Runs the actions on each item; the actions of one item run in order. By
	 * default items are processed one at a time; menu commands process a few in
	 * parallel (each item by one task only, so they never edit the same item).
	 * @param {any[]} items Zotero items
	 * @param {Action[]} actions
	 * @param {{ onItemDone?: (item: any, results: ActionResult[]) => void, concurrency?: number }} [options]
	 * @returns {Promise<Array<{ item: any, results: ActionResult[] }>>} in input order
	 */
	async run(items, actions, { onItemDone = () => {}, concurrency = 1 } = {}) {
		const unique = [...new Set(this.eligible(items))];
		return mapConcurrent(unique, concurrency, async (item) => {
			const context = new ItemContext(new ItemWrapper(item, this.Zotero), this.store);
			const results = [];
			for (const action of actions) {
				results.push(await this.#runOne(action, context));
			}
			onItemDone(item, results);
			return { item, results };
		});
	}

	async #runOne(action, context) {
		try {
			return await action.run(context);
		}
		catch (e) {
			this.log(`Action ${action.id} failed for item ${context.item.item.key}: ${e}\n${e.stack ?? ""}`);
			return result.failed(String(e.message ?? e));
		}
	}
}
