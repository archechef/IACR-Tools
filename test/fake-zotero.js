/**
 * A small in-memory stand-in for the parts of the Zotero API the plugin uses.
 * Item types, fields and base-field mappings come from Zotero's real schema
 * (test/fixtures/zotero-schema.json, a subset of zotero/zotero-schema).
 */
import { readFileSync } from "node:fs";

const schema = JSON.parse(readFileSync(new URL("fixtures/zotero-schema.json", import.meta.url), "utf8"));

function buildSchema() {
	const typeIDs = new Map();
	const fieldIDs = new Map();
	const creatorIDs = new Map();
	const typeFields = new Map(); // typeID -> Set(fieldID)
	const baseMap = new Map(); // `${typeID}:${baseID}` -> fieldID
	const typeCreators = new Map(); // typeID -> Set(creatorTypeID)
	const id = (map, name) => {
		if (!map.has(name)) map.set(name, map.size + 1);
		return map.get(name);
	};
	for (const name of ["extra", "title"]) id(fieldIDs, name);
	for (const type of schema.itemTypes) {
		const typeID = id(typeIDs, type.itemType);
		const fields = new Set();
		for (const { field, baseField } of type.fields) {
			const fieldID = id(fieldIDs, field);
			fields.add(fieldID);
			if (baseField) baseMap.set(`${typeID}:${id(fieldIDs, baseField)}`, fieldID);
		}
		typeFields.set(typeID, fields);
		typeCreators.set(typeID, new Set(type.creatorTypes.map((c) => id(creatorIDs, c.creatorType))));
	}
	const nameOf = (map, wanted) => [...map].find(([, v]) => v === wanted)?.[0];
	return { typeIDs, fieldIDs, creatorIDs, typeFields, baseMap, typeCreators, nameOf };
}

const S = buildSchema();

const toFieldID = (field) => (typeof field === "number" ? field : S.fieldIDs.get(field));

const ItemTypes = {
	getID: (name) => S.typeIDs.get(name),
	getName: (id) => S.nameOf(S.typeIDs, id),
};

const ItemFields = {
	getID: (name) => toFieldID(name) ?? false,
	getName: (id) => S.nameOf(S.fieldIDs, id),
	getFieldIDFromTypeAndBase: (typeID, base) => S.baseMap.get(`${typeID}:${toFieldID(base)}`) ?? false,
	getBaseIDFromTypeAndField(typeID, fieldID) {
		for (const [key, value] of S.baseMap) {
			const [t, base] = key.split(":").map(Number);
			if (t === typeID && value === toFieldID(fieldID)) return base;
		}
		return false;
	},
	isValidForType: (fieldID, typeID) => fieldID === S.fieldIDs.get("extra") || S.typeFields.get(typeID).has(toFieldID(fieldID)),
};

const CreatorTypes = {
	getID: (name) => S.creatorIDs.get(name),
	isValidForItemType: (creatorTypeID, typeID) => S.typeCreators.get(typeID).has(creatorTypeID),
};

let nextID = 1;

export class FakeItem {
	constructor(itemType, { fields = {}, creators = [], synced = false, libraryID = 1 } = {}) {
		this.id = nextID++;
		this.key = `KEY${this.id}`;
		this.itemTypeID = ItemTypes.getID(itemType);
		if (!this.itemTypeID) throw new Error(`Unknown item type ${itemType}`);
		this.libraryID = libraryID;
		this.synced = synced;
		this.deleted = false;
		this.data = new Map();
		this.creators = creators.map((c) => ({ ...c }));
		this.attachments = [];
		this.tags = [];
		this.collections = new Set();
		this.parentItemID = null;
		this.saveCount = 0;
		/** @type {Set<string>} keys of related items */
		this.related = new Set();
		for (const [name, value] of Object.entries(fields)) this.setField(name, value);
	}

	get relatedItems() {
		return [...this.related];
	}

	/** Mirrors Zotero.Item#addRelatedItem: false if already related. */
	addRelatedItem(item) {
		if (item.libraryID !== this.libraryID) throw new Error("Related items must be in the same library");
		if (this.related.has(item.key)) return false;
		this.related.add(item.key);
		return true;
	}

	isFileAttachment() {
		return false;
	}

	isPDFAttachment() {
		return false;
	}

	addTag(tag) {
		this.tags.push(tag);
	}

	addToCollection(id) {
		this.collections.add(id);
	}

	setCollections(ids) {
		this.collections = new Set(ids);
	}

	/** Mirrors Zotero.Item#removeFromCollection (saved with the next save). */
	removeFromCollection(id) {
		this.collections.delete(id);
	}

	/** Mirrors Zotero.Item#getCollections: the ids of the collections the item is directly in. */
	getCollections() {
		return [...this.collections];
	}

	inCollection(id) {
		return this.collections.has(id);
	}

	get itemType() {
		return ItemTypes.getName(this.itemTypeID);
	}

	isRegularItem() {
		return true;
	}

	#resolve(field) {
		const id = toFieldID(field);
		if (!id) throw new Error(`"${field}" is not a valid itemData field`);
		return ItemFields.getFieldIDFromTypeAndBase(this.itemTypeID, id) || id;
	}

	getField(field) {
		if (field === "year") return (this.getField("date") || "").slice(0, 4);
		return this.data.get(this.#resolve(field)) ?? "";
	}

	setField(field, value) {
		const id = this.#resolve(field);
		if (value && !ItemFields.isValidForType(id, this.itemTypeID)) {
			throw new Error(`'${field}' is not a valid field for type '${this.itemType}'`);
		}
		if (value) this.data.set(id, String(value).trim());
		else this.data.delete(id);
	}

	/** Mirrors Zotero.Item#setType: base-mapped fields move, invalid fields are dropped. */
	setType(typeID) {
		const oldTypeID = this.itemTypeID;
		const moved = new Map();
		for (const [fieldID, value] of this.data) {
			if (ItemFields.isValidForType(fieldID, typeID)) {
				moved.set(fieldID, value);
				continue;
			}
			const base = ItemFields.getBaseIDFromTypeAndField(oldTypeID, fieldID);
			const target = base && ItemFields.getFieldIDFromTypeAndBase(typeID, base);
			if (target) moved.set(target, value);
		}
		this.itemTypeID = typeID;
		this.data = moved;
		for (const creator of this.creators) {
			if (!CreatorTypes.isValidForItemType(CreatorTypes.getID(creator.creatorType), typeID)) {
				creator.creatorType = "contributor";
			}
		}
	}

	getCreatorsJSON() {
		return this.creators.map((c) => ({ ...c }));
	}

	setCreators(creators) {
		this.creators = creators.map((c) => ({ ...c }));
	}

	getAttachments() {
		return this.attachments.map((a) => a.id);
	}

	getDisplayTitle() {
		return this.getField("title");
	}

	async saveTx() {
		this.saveCount++;
	}
}

/** An attachment downloaded from a URL (Zotero.Attachments.importFromURL). */
class FakeAttachment {
	constructor({ url, title, contentType, dateAdded = "2026-01-01 00:00:00" }) {
		this.id = nextID++;
		this.url = url;
		this.title = title;
		this.contentType = contentType;
		this.dateAdded = dateAdded;
		this.deleted = false;
		this.saveCount = 0;
	}

	getField(name) {
		return name === "url" ? this.url : name === "title" ? this.title : "";
	}

	setField(name, value) {
		if (name !== "title") throw new Error(`Cannot set ${name} on an attachment`);
		this.title = value;
	}

	getFilePath() {
		return `/storage/${this.id}.pdf`;
	}

	isPDFAttachment() {
		return this.contentType === "application/pdf";
	}

	async saveTx() {
		this.saveCount++;
	}
}

/** A PDF file attachment (stored or linked). */
export class FakeFileAttachment {
	#registry;

	constructor(registry, { path, libraryID = 1, linked = false, parentItemID = null, collections = [], syncedHash = null }) {
		this.#registry = registry;
		this.id = nextID++;
		this.key = `KEY${this.id}`;
		this.path = path;
		this.libraryID = libraryID;
		this.linked = linked;
		this.attachmentSyncedHash = syncedHash;
		this.collections = new Set(collections);
		this.deleted = false;
		this.parentItemID = null;
		this.saveCount = 0;
		registry.set(this.id, this);
		if (parentItemID) this.parentID = parentItemID;
	}

	isRegularItem() {
		return false;
	}

	isFileAttachment() {
		return true;
	}

	isPDFAttachment() {
		return true;
	}

	getFilePath() {
		return this.path;
	}

	getField(name) {
		return name === "title" ? this.path.split("/").pop() : "";
	}

	getDisplayTitle() {
		return this.getField("title");
	}

	/** Mirrors Zotero: a child item leaves its collections. */
	set parentID(id) {
		const old = this.#registry.get(this.parentItemID);
		if (old) old.attachments = old.attachments.filter((a) => a !== this);
		this.parentItemID = id;
		this.collections.clear();
		this.#registry.get(id).attachments.push(this);
	}

	inCollection(id) {
		return this.collections.has(id);
	}

	addToCollection(id) {
		this.collections.add(id);
	}

	async saveTx() {
		this.saveCount++;
	}
}

class FakeCollection {
	constructor(registry, { libraryID, name, parentID = null }) {
		this.registry = registry;
		this.libraryID = libraryID;
		this.name = name;
		this.parentID = parentID;
		this.deleted = false;
	}

	async saveTx() {
		this.id ??= nextID++;
		this.registry.set(this.id, this);
	}
}

/**
 * @param {object} [options]
 * @param {(attachment: FakeFileAttachment) => ({ itemType: string, fields?: object, creators?: object[] } | null)} [options.recognize]
 *   Stand-in for Zotero's metadata retrieval.
 * @param {(attachment: FakeFileAttachment) => string} [options.fullText]
 * @param {(path: string) => Promise<string>} [options.storeFile]  Copies an imported file into "storage".
 * @param {(item: FakeItem) => ({ url: string, title?: string } | null)} [options.findFile]
 *   Stand-in for Zotero's Find Full Text (DOI, open access, custom resolvers).
 */
export function createFakeZotero({
	recognize = () => null, fullText = () => "", storeFile = async (path) => path, clipboard = "", translateDOI = () => null,
	download = (url) => `PDF of ${url}`, now = () => "2026-10-01 12:00:00", findFile = () => null,
} = {}) {
	const registry = new Map();
	const collections = new Map();
	const observers = new Map();
	const prefs = new Map();
	const zotero = {
		ItemTypes,
		ItemFields,
		CreatorTypes,
		launched: [],
		logs: [],
		debug: (msg) => zotero.logs.push(msg),
		launchURL: (url) => zotero.launched.push(url),
		Libraries: { userLibraryID: 1, isEditable: () => true, get: () => ({ name: "My Library" }) },
		Items: {
			get: (ids) => [ids].flat().map((id) => registry.get(id)).filter(Boolean),
			async getAll(libraryID) {
				return [...registry.values()].filter((item) => item.libraryID === libraryID && (item.isRegularItem() || item.isFileAttachment?.()));
			},
			async trashTx(ids) {
				for (const id of ids) registry.get(id).deleted = true;
			},
		},
		Item: class extends FakeItem {
			constructor(itemType) {
				super(itemType);
				this.libraryID = null;
			}

			async saveTx() {
				registry.set(this.id, this);
				await super.saveTx();
			}
		},
		Collection: class extends FakeCollection {
			constructor(params) {
				super(collections, params);
			}

			/** Mirrors Zotero.Collection#getChildItems: the items directly in the collection. */
			getChildItems(asIDs) {
				const items = [...registry.values()].filter((item) => item.collections?.has(this.id) && !item.deleted);
				return asIDs ? items.map((item) => item.id) : items;
			}

			getChildCollections() {
				return [...collections.values()].filter((c) => c.parentID === this.id && !c.deleted);
			}
		},
		Collections: {
			getByLibrary: (libraryID) => [...collections.values()].filter((c) => c.libraryID === libraryID && !c.parentID),
			getByParent: (parentID) => [...collections.values()].filter((c) => c.parentID === parentID),
			get: (id) => collections.get(id),
		},
		RecognizeDocument: {
			recognized: [],
			canRecognize: (item) => item.isPDFAttachment() && !item.parentItemID,
			async recognizeItems(items) {
				for (const attachment of items) {
					zotero.RecognizeDocument.recognized.push(attachment.path);
					const metadata = recognize(attachment);
					if (!metadata) continue;
					const parent = zotero.addItem(metadata.itemType, { ...metadata, libraryID: attachment.libraryID });
					for (const id of attachment.collections) parent.addToCollection(id);
					attachment.parentID = parent.id;
				}
			},
		},
		PDFWorker: {
			async getFullText(itemID) {
				return { text: fullText(registry.get(itemID)) };
			},
		},
		Attachments: {
			async importFromFile({ file, libraryID, collections: ids = [] }) {
				return new FakeFileAttachment(registry, { path: await storeFile(file), libraryID, collections: ids });
			},
			async linkFromFile({ file, collections: ids = [] }) {
				return new FakeFileAttachment(registry, { path: file, linked: true, collections: ids });
			},
			/** Test helper: the calls of addAvailableFile. */
			fileRequests: [],
			/**
			 * Mirrors Zotero.Attachments.addAvailableFile: a PDF attachment found
			 * through the item's DOI, or false when nothing was found.
			 */
			async addAvailableFile(item, options = {}) {
				zotero.Attachments.fileRequests.push({ itemID: item.id, options });
				const found = findFile(item);
				if (!found) return false;
				const attachment = new FakeAttachment({ url: found.url, title: found.title ?? "Full Text PDF", contentType: "application/pdf", dateAdded: now() });
				registry.set(attachment.id, attachment);
				item.attachments.push(attachment);
				return attachment;
			},
			async importFromURL({ parentItemID, url, title, contentType }) {
				const attachment = new FakeAttachment({ url, title, contentType, dateAdded: now() });
				registry.set(attachment.id, attachment);
				registry.get(parentItemID).attachments.push(attachment);
				zotero.files.set(attachment.getFilePath(), download(url));
				return attachment;
			},
		},
		Utilities: {
			Internal: {
				getClipboard: (flavor) => (flavor === "text/plain" ? clipboard : null),
				copyTextToClipboard: (text) => zotero.copied.push(text),
			},
		},
		/** Test helper: everything the plugin put on the clipboard. */
		copied: [],
		/** Test helper: contents of downloaded files, by path. */
		files: new Map(),
		/** Test helper: the translator ids the BibTeX exports used. */
		exports: [],
		Translate: {
			/** A BibTeX export: "@type{key," with the item's citation key or "<lastname><year>". */
			Export: class {
				setItems(items) {
					this.items = items;
				}

				setTranslator(id) {
					this.translatorID = id;
				}

				setHandler(name, handler) {
					if (name === "done") this.done = handler;
				}

				async translate() {
					zotero.exports.push(this.translatorID);
					const keyOf = (item) => item.getField("citationKey")
						|| /^Citation Key: *(.+)$/m.exec(item.getField("extra"))?.[1]
						|| `${(item.creators[0]?.lastName ?? "anon").toLowerCase()}${item.getField("year")}`;
					this.string = this.items.map((item) => `@${item.itemType}{${keyOf(item)},\n  title = {${item.getField("title")}},\n}\n`).join("\n");
					this.done(this, true);
				}
			},
			Search: class {
				setIdentifier(identifier) {
					this.identifier = identifier;
				}

				async getTranslators() {
					return translateDOI(this.identifier?.DOI) ? ["fake-translator"] : [];
				}

				setTranslator() {}
				setHandler() {}

				async translate({ libraryID, collections = [] }) {
					const metadata = translateDOI(this.identifier?.DOI);
					if (!metadata) return [];
					const item = zotero.addItem(metadata.itemType, { ...metadata, libraryID });
					for (const id of collections) item.addToCollection(id);
					return [item];
				}
			},
		},
		Notifier: {
			registerObserver(observer, types, id) {
				observers.set(id, observer);
				return id;
			},
			unregisterObserver: (id) => observers.delete(id),
			trigger: (event, type, ids) => [...observers.values()].forEach((o) => o.notify(event, type, ids, {})),
		},
		Prefs: {
			get: (key) => prefs.get(key),
			set: (key, value) => prefs.set(key, value),
			registerObserver: () => Symbol("observer"),
			unregisterObserver: () => {},
		},
		/** Test helper: creates and registers an item. */
		addItem(itemType, options) {
			const item = new FakeItem(itemType, options);
			registry.set(item.id, item);
			return item;
		},
		/** Test helper: creates a PDF attachment (as child of `parentItemID`, if given). */
		addPDF(options) {
			return new FakeFileAttachment(registry, options);
		},
		/** Test helper: all live collections, as "parent/child" paths. */
		collectionPaths() {
			const pathOf = (c) => (c.parentID ? `${pathOf(collections.get(c.parentID))}/${c.name}` : c.name);
			return [...collections.values()].map(pathOf).sort();
		},
	};
	return zotero;
}
