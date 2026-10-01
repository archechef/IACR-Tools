/**
 * Groups the papers of a library that are probably the same paper: copies of
 * one publication, or versions of one paper (the ePrint preprint, the
 * conference paper, the journal version).
 *
 * Two papers belong together when they share a DOI or an ePrint id, or when
 * their titles and authors match (the year is not compared: versions can be
 * years apart). Within a group, papers of the same item type (or with the same
 * DOI) are copies that can be merged; the others are versions to be linked.
 * Papers of the same item type whose DOIs differ are different publications.
 */
import { scoreCandidate } from "./matching.js";
import { lastNameKey, normalizeDOI, titleKey } from "./text.js";

/**
 * @typedef {object} DuplicatePaper
 * @property {number} id
 * @property {string} itemType
 * @property {string} title
 * @property {string[]} authors  Last names.
 * @property {number} [year]
 * @property {string} [doi]
 * @property {string | null} [eprintId]
 */

/**
 * @template {DuplicatePaper} P
 * @typedef {object} DuplicateGroup
 * @property {P[][]} clusters  Each cluster holds copies of one publication (most hold one paper).
 */

/** Union-find over 0 … n-1. */
class Partition {
	constructor(n) {
		this.parent = Array.from({ length: n }, (_, i) => i);
	}

	find(i) {
		while (this.parent[i] !== i) {
			this.parent[i] = this.parent[this.parent[i]];
			i = this.parent[i];
		}
		return i;
	}

	union(a, b) {
		const [x, y] = [this.find(a), this.find(b)];
		if (x !== y) this.parent[Math.max(x, y)] = Math.min(x, y);
	}

	/** The classes of the indices, in order of their first member. */
	classes(indices) {
		const byRoot = new Map();
		for (const i of indices) {
			const root = this.find(i);
			if (!byRoot.has(root)) byRoot.set(root, []);
			byRoot.get(root).push(i);
		}
		return [...byRoot.values()];
	}
}

/** Appends to a Map of arrays. */
function push(map, key, value) {
	if (!key) return;
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}

/** Different DOIs on papers of the same type: different publications. */
const differentPublications = (a, b, doi) =>
	a.itemType === b.itemType && doi[a.index] && doi[b.index] && doi[a.index] !== doi[b.index];

/**
 * @template {DuplicatePaper} P
 * @param {P[]} papers
 * @returns {DuplicateGroup<P>[]}  Groups of two or more papers, in library order.
 */
export function findDuplicateGroups(papers) {
	const entries = papers.map((paper, index) => ({ ...paper, index }));
	const doi = entries.map((entry) => normalizeDOI(entry.doi));
	const together = new Partition(entries.length);

	/** @type {Map<string, number[]>} */ const byDOI = new Map();
	/** @type {Map<string, number[]>} */ const byEprint = new Map();
	/** @type {Map<string, number[]>} */ const byTitle = new Map();
	/** @type {Map<string, number[]>} */ const byAuthor = new Map();
	for (const entry of entries) {
		push(byDOI, doi[entry.index], entry.index);
		push(byEprint, entry.eprintId, entry.index);
		push(byTitle, titleKey(entry.title), entry.index);
		for (const author of new Set(entry.authors.map(lastNameKey))) push(byAuthor, author, entry.index);
	}
	for (const list of [...byDOI.values(), ...byEprint.values()]) {
		for (const i of list.slice(1)) {
			if (!differentPublications(entries[list[0]], entries[i], doi)) together.union(list[0], i);
		}
	}

	// Title and authors, compared only among papers sharing the exact title or an author.
	for (const entry of entries) {
		const candidates = new Set(byTitle.get(titleKey(entry.title)) ?? []);
		for (const author of entry.authors) {
			for (const i of byAuthor.get(lastNameKey(author)) ?? []) candidates.add(i);
		}
		for (const i of candidates) {
			if (i <= entry.index || together.find(i) === together.find(entry.index)) continue;
			const other = entries[i];
			if (differentPublications(entry, other, doi)) continue;
			const query = { title: entry.title, authors: entry.authors, year: entry.year };
			if (scoreCandidate(query, { title: other.title, authors: other.authors, year: other.year }, { yearTolerance: null })) {
				together.union(entry.index, i);
			}
		}
	}

	const groups = [];
	for (const members of together.classes(entries.map((entry) => entry.index))) {
		if (members.length < 2) continue;
		// Copies: the same DOI, or the same item type without conflicting DOIs.
		const copies = new Partition(entries.length);
		for (const [n, a] of members.entries()) {
			for (const b of members.slice(n + 1)) {
				const [x, y] = [entries[a], entries[b]];
				const sameDOI = doi[a] && doi[a] === doi[b];
				if (sameDOI || (x.itemType === y.itemType && !differentPublications(x, y, doi))) copies.union(a, b);
			}
		}
		groups.push({ clusters: copies.classes(members).map((cluster) => cluster.map((i) => papers[i])) });
	}
	return groups;
}
