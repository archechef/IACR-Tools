/**
 * An item-tree column showing the stored ePrint id, so the id behaves like a
 * (sortable) field even though Zotero stores it in Extra.
 */
import { PLUGIN } from "../config.js";

/**
 * @param {object} deps
 * @param {any} deps.Zotero
 * @param {string} deps.label
 * @param {(item: any) => string} deps.eprintIdOf
 * @returns {Promise<string | false>} registered data key
 */
export async function registerEprintColumn({ Zotero, label, eprintIdOf }) {
	return Zotero.ItemTreeManager.registerColumn({
		dataKey: "eprint",
		label,
		pluginID: PLUGIN.id,
		dataProvider: (item) => (item.isRegularItem() ? eprintIdOf(item) : ""),
	});
}

export async function unregisterEprintColumn(Zotero, dataKey) {
	if (dataKey) await Zotero.ItemTreeManager.unregisterColumn(dataKey);
}
