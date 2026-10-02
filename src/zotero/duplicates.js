/**
 * Duplicate papers across versions: finds the groups (see core/duplicates.js)
 * in a library and carries out what the report window asks for: merge the
 * copies of a publication, merge a paper's ePrint preprint into its published
 * version, link the versions of a paper as related items, or remember that a
 * group is not the same paper.
 */
import { DUPLICATES, EPRINT, EXTRA, LIST } from "../config.js";
import { findDuplicateGroups } from "../core/duplicates.js";
import { storedEprintId } from "./eprint.js";
import { ItemWrapper } from "./item.js";

/**
 * @typedef {object} ReportPaper
 * @property {number} id
 * @property {string} key
 * @property {any} item  Zotero.Item
 * @property {string} itemType
 * @property {string} title
 * @property {string[]} authors
 * @property {number} [year]
 * @property {string} [doi]
 * @property {string | null} eprintId
 * @property {string} citationKey
 * @property {string} venue
 * @property {number} attachments
 * @property {string} dateAdded
 */

/**
 * @typedef {object} ReportGroup
 * @property {string} id         Signature: the sorted item keys.
 * @property {ReportPaper[][]} clusters
 * @property {boolean} linked    Every version is already linked with the others (related items).
 */

export class DuplicateFinder {
	/**
	 * @param {object} deps
	 * @param {any} deps.Zotero
	 * @param {import("./prefs.js").Prefs} deps.prefs
	 * @param {(master: any, others: any[]) => Promise<void>} deps.mergeItems  Zotero's mergeItems.mjs.
	 */
	constructor({ Zotero, prefs, mergeItems }) {
		this.Zotero = Zotero;
		this.prefs = prefs;
		this.mergeItems = mergeItems;
	}

	/** @returns {ReportPaper} */
	#paper(item, eprintKey) {
		const wrapper = new ItemWrapper(item, this.Zotero);
		const { title, authors, year, doi } = wrapper.reference;
		return {
			id: item.id,
			key: item.key,
			item,
			itemType: wrapper.itemType,
			title,
			authors,
			year,
			doi,
			eprintId: storedEprintId(wrapper, eprintKey),
			citationKey: wrapper.getField("citationKey") || wrapper.getExtra(EXTRA.citationKey) || "",
			venue: wrapper.getField("publicationTitle") || wrapper.getField("conferenceName") || wrapper.getField("repository"),
			attachments: item.getAttachments().length,
			dateAdded: item.dateAdded ?? "",
		};
	}

	/**
	 * The groups of probable duplicates in a library. Groups marked as
	 * different papers are left out; versions that are already linked are
	 * reported too (flagged `linked`), since they can still be merged.
	 * @param {number} libraryID
	 * @param {{ scope?: Set<number> | null }} [options]  Only groups with a member among these item ids.
	 * @returns {Promise<{ papers: number, groups: ReportGroup[] }>}
	 */
	async find(libraryID, { scope = null } = {}) {
		const eprintKey = String(this.prefs.get("eprintExtraKey"));
		const items = (await this.Zotero.Items.getAll(libraryID, false, false))
			.filter((item) => item.isRegularItem() && !item.deleted);
		const papers = items.map((item) => this.#paper(item, eprintKey));
		const dismissed = new Set(this.#dismissed());
		/** @type {ReportGroup[]} */
		const found = findDuplicateGroups(papers).map(({ clusters }) => {
			const typed = /** @type {ReportPaper[][]} */ (clusters);
			const sorted = typed.map((cluster) => cluster.sort(byPreference));
			return { id: signature(typed.flat()), clusters: sorted, linked: allLinked(sorted) };
		});
		const groups = found
			.filter((group) => !dismissed.has(group.id))
			.filter((group) => !scope || group.clusters.flat().some((paper) => scope.has(paper.id)));
		return { papers: papers.length, groups };
	}

	/**
	 * Merges the copies of a cluster into the one to keep (Zotero's own merge:
	 * notes, tags, collections, relations and attachments move to it, the others
	 * go to the trash). Copies of another type are converted to its type first,
	 * as Zotero merges only items of the same type.
	 * @param {ReportPaper[]} cluster
	 * @param {number} keepID
	 * @returns {Promise<any>} the kept item
	 */
	async merge(cluster, keepID) {
		const live = cluster.filter((paper) => !paper.item.deleted);
		const keep = live.find((paper) => paper.id === keepID);
		if (!keep) throw new Error("The item to keep is no longer in the library");
		const others = live.filter((paper) => paper !== keep).map((paper) => paper.item);
		if (!others.length) return keep.item;
		for (const other of others) {
			if (other.itemTypeID !== keep.item.itemTypeID) other.setType(keep.item.itemTypeID);
		}
		await this.mergeItems(keep.item, others);
		return keep.item;
	}

	/**
	 * The published versions a group's preprint can be merged into, the
	 * preferred one first; empty if the group has no preprint or no published
	 * version.
	 * @param {ReportGroup} group
	 * @returns {ReportPaper[]}
	 */
	mergeTargets(group) {
		const live = group.clusters.flat().filter((paper) => !paper.item.deleted);
		if (!live.some(isPreprint)) return [];
		return live.filter((paper) => !isPreprint(paper)).sort(byPreference);
	}

	/**
	 * Merges the group's ePrint preprints into one of its published versions
	 * (Zotero's own merge). The published item keeps its metadata, records the
	 * ePrint id in Extra, and receives the preprints' attachments, notes, tags,
	 * collections and relations; the preprints go to the trash. Other published
	 * versions (e.g. a journal version next to the conference paper) stay.
	 * @param {ReportGroup} group
	 * @param {number} targetID  A published version of the group.
	 * @returns {Promise<any>} the kept item
	 */
	async mergeVersions(group, targetID) {
		const target = this.mergeTargets(group).find((paper) => paper.id === targetID);
		if (!target) throw new Error("The published version to keep is no longer in the library");
		const preprints = group.clusters.flat().filter((paper) => isPreprint(paper) && !paper.item.deleted);
		const eprintKey = String(this.prefs.get("eprintExtraKey"));
		const kept = new ItemWrapper(target.item, this.Zotero);
		const eprintId = target.eprintId ?? preprints.map((paper) => paper.eprintId).find(Boolean);
		if (eprintId && !kept.getExtra(eprintKey)) {
			kept.setExtra(eprintKey, eprintId);
			await kept.save();
		}
		// Zotero merges items of one type; the preprints' own fields are dropped by the merge anyway.
		for (const { item } of preprints) item.setType(target.item.itemTypeID);
		await this.mergeItems(target.item, preprints.map((paper) => paper.item));
		return target.item;
	}

	/**
	 * Links every version of the group with every other one as related items.
	 * @param {ReportGroup} group
	 * @returns {Promise<number>} links added
	 */
	async link(group) {
		const live = group.clusters
			.map((cluster) => cluster.filter((paper) => !paper.item.deleted))
			.filter((cluster) => cluster.length);
		let added = 0;
		for (const [n, cluster] of live.entries()) {
			for (const other of live.slice(n + 1).flat()) {
				for (const paper of cluster) {
					const wrapper = new ItemWrapper(paper.item, this.Zotero);
					if (await wrapper.relateTo(other.item)) {
						added++;
						await paper.item.saveTx();
					}
				}
			}
		}
		return added;
	}

	/** Remembers that a group is not the same paper; it is not reported again (unless it changes). */
	dismiss(group) {
		const list = this.#dismissed().filter((id) => id !== group.id);
		list.push(group.id);
		this.prefs.set("duplicatesDismissed", JSON.stringify(list.slice(-DUPLICATES.maxDismissed)));
	}

	/** @returns {string[]} */
	#dismissed() {
		try {
			const list = JSON.parse(String(this.prefs.get("duplicatesDismissed") || "[]"));
			return Array.isArray(list) ? list.filter((id) => typeof id === "string") : [];
		}
		catch {
			return [];
		}
	}
}

/** A group's identity: its members' keys, sorted. A group that gains a member is a new group. */
function signature(papers) {
	return papers.map((paper) => paper.key).sort().join(" ");
}

/** Whether every paper is linked (related items) with the papers of the other clusters. */
function allLinked(clusters) {
	if (clusters.length < 2) return false;
	return clusters.every((cluster, n) => cluster.every((paper) => clusters.every((others, m) =>
		m === n || others.every((other) => paper.item.relatedItems.includes(other.key)))));
}

/** @param {ReportPaper} paper */
const isPreprint = (paper) => paper.itemType === EPRINT.itemType;

/**
 * The copy to keep first: the one with a CryptoBib key, then a DOI, then more
 * attachments, then the oldest.
 * @param {ReportPaper} a
 * @param {ReportPaper} b
 */
function byPreference(a, b) {
	const rank = (paper) => [
		CRYPTOBIB_KEY.test(paper.citationKey) ? 0 : 1,
		paper.doi ? 0 : 1,
		-paper.attachments,
	];
	const [x, y] = [rank(a), rank(b)];
	for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
	return a.dateAdded < b.dateAdded ? -1 : a.dateAdded > b.dateAdded ? 1 : 0;
}

const CRYPTOBIB_KEY = LIST.cryptobibKeyPattern;
