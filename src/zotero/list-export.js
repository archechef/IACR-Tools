/**
 * Copying papers out of the library as a reading list, in the same format the
 * list import reads — so a selection can travel to a chat and its answer can
 * come straight back.
 */
import { LIST } from "../config.js";
import { formatList, formatSections } from "../core/list-format.js";
import { storedEprintId } from "./eprint.js";
import { ItemWrapper } from "./item.js";

/**
 * @param {any} Zotero
 * @param {any[]} items Zotero items (attachments and notes are ignored).
 * @param {string} eprintKey
 * @returns {import("../core/list-format.js").ListPaper[]}
 */
export function papersFromItems(Zotero, items, eprintKey) {
	const papers = [];
	for (const item of items ?? []) {
		if (!item?.isRegularItem?.() || item.deleted) continue;
		const wrapper = new ItemWrapper(item, Zotero);
		const citationKey = wrapper.citationKey;
		papers.push({
			eprintId: storedEprintId(wrapper, eprintKey) ?? undefined,
			doi: wrapper.doi || undefined,
			// Only CryptoBib's own keys are useful to the other side.
			key: LIST.cryptobibKeyPattern.test(citationKey) ? citationKey : undefined,
			title: wrapper.getField("title"),
		});
		if (papers.length >= LIST.maxEntries) break;
	}
	return papers;
}

/**
 * The list text for a set of items.
 * @param {any} Zotero
 * @param {any[]} items
 * @param {{ eprintKey: string, header?: string }} options
 */
export function itemsAsList(Zotero, items, { eprintKey, header }) {
	return formatList(papersFromItems(Zotero, items, eprintKey), { header });
}

/**
 * The list text for a collection: its own papers, then a "[Sub / Sub]"
 * section for each subcollection, so that importing the list elsewhere
 * rebuilds the structure. A paper in two subcollections is listed in both.
 * @param {any} Zotero
 * @param {any} collection
 * @param {{ eprintKey: string, header?: string, subcollections?: boolean }} options
 *   subcollections: false lists only the collection's own papers.
 * @returns {{ text: string, count: number }} count: different papers listed
 */
export function collectionAsList(Zotero, collection, { eprintKey, header, subcollections = true }) {
	const sections = [];
	const listed = new Set();
	let lines = 0;
	const visit = (current, path) => {
		if (lines >= LIST.maxEntries) return;
		const items = Zotero.Items.get(current.getChildItems(true))
			.filter((item) => item?.isRegularItem?.() && !item.deleted)
			.slice(0, LIST.maxEntries - lines);
		const papers = papersFromItems(Zotero, items, eprintKey);
		lines += papers.length;
		for (const item of items) listed.add(item.id);
		sections.push({ path, papers });
		if (!subcollections) return;
		const children = current.getChildCollections(false).filter((child) => !child.deleted)
			.sort((a, b) => a.name.localeCompare(b.name));
		for (const child of children) visit(child, [...path, child.name]);
	};
	visit(collection, []);
	return { text: formatSections(sections, { header }), count: listed.size };
}
