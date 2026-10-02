/**
 * Creating Zotero items from the plugin's own sources: a CryptoBib record or an
 * IACR ePrint paper page.
 */
import { EPRINT } from "../config.js";
import { toZoteroData } from "../core/mapping.js";
import { applyZoteroData } from "./cryptobib-sync.js";
import { ItemWrapper } from "./item.js";

/**
 * @typedef {object} CreateContext
 * @property {number} libraryID
 * @property {number[]} [collectionIDs]
 * @property {string} eprintKey  Extra-field key for the ePrint id.
 */

/**
 * @param {any} Zotero
 * @param {import("../core/cryptobib.js").CryptoBibRecord} record
 * @param {CreateContext} context
 * @returns {Promise<any>} the saved Zotero.Item
 */
export function createItemFromRecord(Zotero, record, context) {
	return saveItem(Zotero, toZoteroData(record), [], context);
}

/**
 * @param {any} Zotero
 * @param {import("../core/eprint-page.js").EprintPaper} paper
 * @param {CreateContext} context
 * @returns {Promise<any>} the saved Zotero.Item
 */
export function createItemFromEprintPaper(Zotero, paper, context) {
	/** @type {import("../core/mapping.js").ZoteroData} */
	const data = {
		itemType: EPRINT.itemType,
		fields: [
			{ candidates: ["title"], value: paper.title },
			{ candidates: ["abstractNote"], value: paper.abstract },
			{ candidates: ["repository", "publisher"], value: paper.repository },
			{ candidates: ["archiveID"], value: paper.id },
			{ candidates: ["date"], value: paper.date },
			{ candidates: ["url"], value: paper.url },
		].filter((field) => field.value),
		creators: paper.creators,
		citationKey: "",
		eprintId: paper.id,
	};
	return saveItem(Zotero, data, paper.tags, context);
}

/**
 * @param {any} Zotero
 * @param {import("../core/mapping.js").ZoteroData} data
 * @param {string[]} tags
 * @param {CreateContext} context
 */
async function saveItem(Zotero, data, tags, { libraryID, collectionIDs = [], eprintKey }) {
	const item = new Zotero.Item(data.itemType);
	item.libraryID = libraryID;
	const wrapper = new ItemWrapper(item, Zotero);
	applyZoteroData(wrapper, data, { overwrite: true, replaceCreators: true });
	if (data.eprintId) wrapper.setExtra(eprintKey, data.eprintId);
	for (const tag of tags) item.addTag(tag);
	if (collectionIDs.length) item.setCollections(collectionIDs);
	await item.saveTx();
	return item;
}
