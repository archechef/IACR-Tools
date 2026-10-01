/**
 * Copying papers out of the library as a reading list, in the same format the
 * list import reads — so a selection can travel to a chat and its answer can
 * come straight back.
 */
import { EXTRA, LIST } from "../config.js";
import { formatList } from "../core/list-format.js";
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
		const citationKey = wrapper.getField("citationKey") || wrapper.getExtra(EXTRA.citationKey) || "";
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
