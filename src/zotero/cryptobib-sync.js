/**
 * Aligns an item's metadata with its CryptoBib entry.
 */
import { CRYPTOBIB } from "../config.js";
import { toZoteroData } from "../core/mapping.js";
import { result } from "./pipeline.js";

/**
 * Applies CryptoBib data to an item and returns the names of changed fields.
 * @param {import("./item.js").ItemWrapper} item
 * @param {import("../core/mapping.js").ZoteroData} data
 * @param {{ overwrite: boolean, replaceCreators: boolean }} options
 */
export function applyZoteroData(item, data, { overwrite, replaceCreators }) {
	const changes = [];
	const allowedTypes = CRYPTOBIB.typeConversions[item.itemType] ?? [];
	if (data.itemType !== item.itemType && allowedTypes.includes(data.itemType)) {
		item.convertTo(data.itemType);
		changes.push("itemType");
	}
	for (const { candidates, value } of data.fields) {
		const changed = item.setField(candidates, value, { overwrite });
		if (changed) changes.push(changed);
	}
	if (replaceCreators && item.replaceCreators(data.creators)) changes.push("creators");
	const keyField = item.setCitationKey(data.citationKey, { overwrite });
	if (keyField) changes.push(keyField);
	return changes;
}

/**
 * @param {import("./prefs.js").Prefs} prefs
 * @returns {import("./pipeline.js").Action}
 */
export function createCryptoBibSyncAction(prefs) {
	return Object.freeze({
		id: "sync-cryptobib",
		async run(context) {
			const { item } = context;
			if (CRYPTOBIB.skippedItemTypes.includes(item.itemType)) return result.skipped(item.itemType);
			const match = await context.publicationMatch();
			if (!match) return result.unchanged("no CryptoBib entry");
			const changes = applyZoteroData(item, toZoteroData(match.candidate), {
				overwrite: prefs.get("overwriteFields"),
				replaceCreators: prefs.get("replaceCreators"),
			});
			await item.save();
			const detail = match.candidate.key;
			return changes.length ? result.changed(detail) : result.unchanged(detail);
		},
	});
}
