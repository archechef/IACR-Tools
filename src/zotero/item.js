/**
 * A convenience wrapper around Zotero.Item that knows about base fields, the
 * Extra field fallback and item type conversion. All item edits of the plugin
 * go through this class.
 */
import { EXTRA } from "../config.js";
import { getExtraField, setExtraField } from "../core/extra.js";
import { normalizeDOI } from "../core/text.js";

export class ItemWrapper {
	#changed = false;

	/**
	 * @param {any} item Zotero.Item
	 * @param {any} Zotero
	 */
	constructor(item, Zotero) {
		this.item = item;
		this.Zotero = Zotero;
	}

	get itemType() {
		return this.Zotero.ItemTypes.getName(this.item.itemTypeID);
	}

	/**
	 * Resolves a (base) field name to the name used by this item's type, e.g.
	 * "publicationTitle" → "proceedingsTitle"; null if the type lacks the field.
	 */
	#fieldName(name) {
		const { ItemFields } = this.Zotero;
		const baseID = ItemFields.getID(name);
		if (!baseID) return null;
		const fieldID = ItemFields.getFieldIDFromTypeAndBase(this.item.itemTypeID, baseID) || baseID;
		return ItemFields.isValidForType(fieldID, this.item.itemTypeID) ? ItemFields.getName(fieldID) : null;
	}

	hasField(name) {
		return this.#fieldName(name) !== null;
	}

	/** Reads a field; base field names are resolved for the item type. */
	getField(name) {
		const fieldName = this.#fieldName(name);
		return fieldName ? this.item.getField(fieldName) : "";
	}

	/**
	 * Sets the first field among `candidates` that is valid for the item type.
	 * @param {string[]} candidates
	 * @param {string} value
	 * @param {{ overwrite?: boolean }} [options]
	 * @returns {string | null} Name of the field that changed, or null.
	 */
	setField(candidates, value, { overwrite = true } = {}) {
		const name = candidates.map((candidate) => this.#fieldName(candidate)).find(Boolean);
		if (!name || !value) return null;
		const current = this.item.getField(name);
		if (current === value || (current && !overwrite)) return null;
		this.item.setField(name, value);
		this.#changed = true;
		return name;
	}

	getExtra(key) {
		return getExtraField(this.item.getField("extra"), key);
	}

	/** @returns {boolean} whether the Extra field changed */
	setExtra(key, value) {
		const extra = this.item.getField("extra");
		const updated = setExtraField(extra, key, value);
		if (updated === extra) return false;
		this.item.setField("extra", updated);
		this.#changed = true;
		return true;
	}

	/** DOI from the DOI field or, for types without one, from Extra ("DOI: …"). */
	get doi() {
		return normalizeDOI(this.getField("DOI") || this.getExtra(EXTRA.doi));
	}

	/**
	 * Stores the citation key in the dedicated field when the Zotero schema has
	 * it, otherwise as "Citation Key: …" in Extra (understood by Better BibTeX).
	 */
	setCitationKey(key, { overwrite = true } = {}) {
		if (this.hasField("citationKey")) return this.setField(["citationKey"], key, { overwrite });
		if (this.getExtra(EXTRA.citationKey) && !overwrite) return null;
		return this.setExtra(EXTRA.citationKey, key) ? EXTRA.citationKey : null;
	}

	/** @returns {import("../core/matching.js").Reference} */
	get reference() {
		const authors = this.item.getCreatorsJSON()
			.filter((c) => c.creatorType === "author")
			.map((c) => c.lastName ?? c.name ?? "");
		const year = Number.parseInt(this.item.getField("year"), 10);
		return {
			title: this.getField("title"),
			authors,
			year: Number.isFinite(year) ? year : undefined,
			doi: this.doi || undefined,
		};
	}

	/**
	 * Replaces the creators of the given types, keeping the others (e.g. translators).
	 * @param {import("../core/mapping.js").ZoteroCreator[]} creators
	 * @returns {boolean} whether anything changed
	 */
	replaceCreators(creators) {
		const { CreatorTypes } = this.Zotero;
		const typeID = this.item.itemTypeID;
		const valid = creators.filter((c) => CreatorTypes.isValidForItemType(CreatorTypes.getID(c.creatorType), typeID));
		if (!valid.length) return false;
		const replacedTypes = new Set(valid.map((c) => c.creatorType));
		const current = this.item.getCreatorsJSON();
		const toJSON = ({ firstName, lastName, fieldMode, creatorType }) => (fieldMode === 1
			? { name: lastName, creatorType }
			: { firstName, lastName, creatorType });
		const updated = [
			...valid.map(toJSON),
			...current.filter((c) => !replacedTypes.has(c.creatorType)),
		];
		if (JSON.stringify(updated) === JSON.stringify(current)) return false;
		this.item.setCreators(updated);
		this.#changed = true;
		return true;
	}

	/**
	 * Changes the item type. Zotero moves base-mapped fields (bookTitle →
	 * proceedingsTitle) itself; a DOI parked in Extra is moved to the DOI field.
	 * @returns {boolean} whether the type changed
	 */
	convertTo(itemType) {
		if (this.itemType === itemType) return false;
		const doi = this.doi;
		this.item.setType(this.Zotero.ItemTypes.getID(itemType));
		if (doi && this.hasField("DOI") && !this.getField("DOI")) {
			this.item.setField("DOI", doi);
			this.setExtra(EXTRA.doi, null);
		}
		this.#changed = true;
		return true;
	}

	async save() {
		if (!this.#changed) return false;
		await this.item.saveTx();
		this.#changed = false;
		return true;
	}
}
