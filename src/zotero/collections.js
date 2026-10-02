/**
 * Collections by path below a base collection (or the library root), created
 * when missing. The imports use it to file papers into subcollections: the
 * folder import mirrors folders, the list import follows the list's sections.
 */
import { collectionNameKey } from "../core/list.js";

export class CollectionPaths {
	/** @type {Map<string, Promise<number | null>>} */
	#byPath = new Map();

	/**
	 * @param {any} Zotero
	 * @param {number} libraryID
	 * @param {number | null} baseCollectionID  null: the library root.
	 */
	constructor(Zotero, libraryID, baseCollectionID) {
		this.Zotero = Zotero;
		this.libraryID = libraryID;
		this.baseCollectionID = baseCollectionID ?? null;
		/** @type {string[][]} paths of the collections created so far */
		this.created = [];
	}

	/**
	 * The collection at a path below the base, created level by level where
	 * missing. Existing collections are matched by name regardless of case.
	 * @param {string[]} path
	 * @returns {Promise<number | null>} null for the library root
	 */
	async resolve(path) {
		let parentID = this.baseCollectionID;
		for (let depth = 1; depth <= path.length; depth++) {
			const key = JSON.stringify(path.slice(0, depth).map(collectionNameKey));
			// Memoized as a promise, so that two entries naming a new collection at once create it once.
			if (!this.#byPath.has(key)) this.#byPath.set(key, this.#findOrCreate(path.slice(0, depth), parentID));
			parentID = await this.#byPath.get(key);
		}
		return parentID;
	}

	async #findOrCreate(path, parentID) {
		const { Collections, Collection } = this.Zotero;
		const name = path.at(-1);
		const siblings = parentID ? Collections.getByParent(parentID) : Collections.getByLibrary(this.libraryID);
		const existing = siblings.find((c) => !c.deleted && collectionNameKey(c.name) === collectionNameKey(name));
		if (existing) return existing.id;
		const collection = new Collection({ libraryID: this.libraryID, name, ...(parentID ? { parentID } : {}) });
		await collection.saveTx();
		this.created.push(path);
		return collection.id;
	}

	/** Names from the library root down to the base collection ([] for the root). */
	basePath() {
		return this.#namesUpTo(this.baseCollectionID, null);
	}

	/**
	 * A collection's name as the user knows it in this import: its path below
	 * the base, or the base's own name.
	 * @param {number} collectionID
	 */
	displayName(collectionID) {
		const names = collectionID === this.baseCollectionID
			? this.#namesUpTo(collectionID, null).slice(-1)
			: this.#namesUpTo(collectionID, this.baseCollectionID);
		return names.join(" / ");
	}

	/** The base collection and all collections below it (empty for the library root). */
	subtree() {
		const ids = new Set();
		const visit = (collection) => {
			ids.add(collection.id);
			for (const child of collection.getChildCollections(false)) visit(child);
		};
		const base = this.baseCollectionID ? this.Zotero.Collections.get(this.baseCollectionID) : null;
		if (base) visit(base);
		return ids;
	}

	#namesUpTo(collectionID, stopID) {
		const names = [];
		let current = collectionID ? this.Zotero.Collections.get(collectionID) : null;
		// Bounded, in case of a broken parent chain.
		for (let depth = 0; current && current.id !== stopID && depth < 100; depth++) {
			names.unshift(current.name);
			current = current.parentID ? this.Zotero.Collections.get(current.parentID) : null;
		}
		return names;
	}
}
