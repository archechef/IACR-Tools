/**
 * The duplicate report: the state behind content/duplicates.xhtml and the
 * actions its buttons call (merge, link, not the same paper, show in library).
 */
import { ASSETS, chromeURL } from "../config.js";

/** Authors shown per paper before "et al.". */
const MAX_AUTHORS = 6;

/**
 * @typedef {object} PaperView  What the window shows of a paper.
 * @property {number} id
 * @property {string} type
 * @property {string} title
 * @property {string} authors
 * @property {string} [year]
 * @property {string} venue
 * @property {string} [doi]
 * @property {string | null} eprintId
 * @property {string} citationKey
 * @property {number} attachments
 */

/**
 * @typedef {object} GroupView
 * @property {string} id
 * @property {PaperView[][]} clusters
 * @property {Record<number, number>} keep  Per copy cluster: the id of the item to keep.
 * @property {boolean} busy
 * @property {boolean} linked
 * @property {{ text: string, error?: boolean } | null} result  Set when the group is done.
 * @property {string} [note]
 */

export class DuplicatesView {
	/** @type {Set<(state: DuplicatesView["state"], change?: { group?: string }) => void>} */
	#listeners = new Set();
	/** @type {Map<string, import("../zotero/duplicates.js").ReportGroup>} */
	#groups = new Map();

	state = {
		headline: "",
		status: "",
		/** @type {GroupView[]} */
		groups: [],
	};

	/**
	 * @param {object} deps
	 * @param {any} deps.Zotero
	 * @param {import("./l10n.js").L10n} deps.l10n
	 * @param {import("../zotero/duplicates.js").DuplicateFinder} deps.finder
	 * @param {(msg: string) => void} deps.log
	 */
	constructor({ Zotero, l10n, finder, log }) {
		this.Zotero = Zotero;
		this.l10n = l10n;
		this.finder = finder;
		this.log = log;
	}

	/**
	 * Opens the report window.
	 * @param {any} parentWindow
	 * @param {{ papers: number, groups: import("../zotero/duplicates.js").ReportGroup[] }} report
	 * @param {string} where  Library or collection name, for the headline.
	 */
	open(parentWindow, report, where) {
		this.#groups = new Map(report.groups.map((group) => [group.id, group]));
		this.state.headline = this.format("dup-headline", { where });
		this.state.status = this.format("dup-status", { papers: report.papers, groups: report.groups.length });
		this.state.groups = report.groups.map((group) => this.#groupView(group));
		this.window = parentWindow.openDialog(chromeURL(ASSETS.duplicatesDialog), "_blank",
			"chrome,dialog=no,resizable,centerscreen,width=760,height=620", this);
	}

	/** Called by the window. */
	format(localId, args) {
		return this.l10n.format(localId, args);
	}

	/** Called by the window: `listener(state, change)` after every change. */
	subscribe(listener) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Merges the copies of one cluster into the chosen item. */
	merge(groupID, clusterIndex, keepID) {
		return this.#act(groupID, async (group, view) => {
			const kept = await this.finder.merge(group.clusters[clusterIndex], keepID);
			group.clusters[clusterIndex] = group.clusters[clusterIndex].filter((paper) => paper.item === kept);
			view.clusters = group.clusters.map((cluster) => cluster.map((paper) => this.#paperView(paper)));
			const text = this.format("dup-merged", { title: kept.getDisplayTitle() });
			// Versions may remain to be linked; otherwise the group is done.
			if (group.clusters.length > 1 && !view.linked) view.note = text;
			else view.result = { text };
		});
	}

	/** Links the versions of a group as related items. */
	link(groupID) {
		return this.#act(groupID, async (group, view) => {
			await this.finder.link(group);
			view.linked = true;
			const text = this.format("dup-linked");
			if (group.clusters.some((cluster) => cluster.length > 1)) view.note = text;
			else view.result = { text };
		});
	}

	/** Remembers that a group is not the same paper. */
	dismiss(groupID) {
		return this.#act(groupID, async (group, view) => {
			this.finder.dismiss(group);
			view.result = { text: this.format("dup-dismissed") };
		});
	}

	/** Links the versions of every open group. */
	async linkAll() {
		for (const view of this.state.groups) {
			if (!view.result && !view.linked && view.clusters.length > 1) await this.link(view.id);
		}
	}

	/** Selects the group's items in the main window. */
	show(groupID) {
		const group = this.#groups.get(groupID);
		if (!group) return;
		const ids = group.clusters.flat().filter((paper) => !paper.item.deleted).map((paper) => paper.id);
		const pane = this.Zotero.getActiveZoteroPane?.();
		pane?.selectItems?.(ids);
		this.Zotero.getMainWindow?.()?.focus?.();
	}

	async #act(groupID, action) {
		const group = this.#groups.get(groupID);
		const view = this.state.groups.find((g) => g.id === groupID);
		if (!group || !view || view.busy || view.result) return;
		view.busy = true;
		this.#emit({ group: groupID });
		try {
			await action(group, view);
		}
		catch (e) {
			this.log(`Duplicate report action failed: ${e}\n${e.stack ?? ""}`);
			view.result = { text: String(e?.message ?? e), error: true };
		}
		finally {
			view.busy = false;
			this.#emit({ group: groupID });
		}
	}

	/** @returns {GroupView} */
	#groupView(group) {
		/** @type {Record<number, number>} */
		const keep = {};
		for (const [i, cluster] of group.clusters.entries()) if (cluster.length > 1) keep[i] = cluster[0].id;
		return {
			id: group.id,
			clusters: group.clusters.map((cluster) => cluster.map((paper) => this.#paperView(paper))),
			keep,
			busy: false,
			linked: false,
			result: null,
		};
	}

	/** @returns {PaperView} */
	#paperView(paper) {
		const authors = paper.authors.length > MAX_AUTHORS
			? `${paper.authors.slice(0, MAX_AUTHORS).join(", ")} et al.`
			: paper.authors.join(", ");
		return {
			id: paper.id,
			type: this.Zotero.ItemTypes.getLocalizedString?.(paper.itemType) ?? paper.itemType,
			title: paper.title,
			authors,
			year: paper.year ? String(paper.year) : undefined,
			venue: paper.venue,
			doi: paper.doi,
			eprintId: paper.eprintId,
			citationKey: paper.citationKey,
			attachments: paper.attachments,
		};
	}

	#emit(change) {
		for (const listener of this.#listeners) {
			try {
				listener(this.state, change);
			}
			catch {
				this.#listeners.delete(listener);
			}
		}
	}
}
