/**
 * Imports the PDFs of a folder and its subfolders, skipping papers that the
 * library already has.
 *
 * 1. scan(): lists the PDFs and marks those whose file is already in the library
 *    (same path or same content) or that repeat another file of the folder.
 *    Nothing is changed.
 * 2. run(): imports the remaining files. Each one is recognized by Zotero (or,
 *    failing that, identified in CryptoBib from its file name and text),
 *    converted and updated from CryptoBib. A paper that turns out to be in the
 *    library already is moved to the trash, or its PDF is attached to the
 *    existing item when that has none. New papers optionally get their ePrint
 *    version looked up.
 */
import { FOLDER_IMPORT } from "../config.js";
import { identifyInCryptoBib } from "../core/pdf-text.js";
import { CollectionPaths } from "./collections.js";
import { createItemFromRecord } from "./create-item.js";
import { ItemWrapper } from "./item.js";
import { LibraryIndex } from "./library-index.js";

/**
 * @typedef {object} FolderFile
 * @property {string} path
 * @property {string} name
 * @property {string[]} folders  Subfolders between the chosen folder and the file.
 * @property {number} size
 * @property {"new" | "exists" | "repeat"} status  Result of the scan.
 * @property {any} [existing]  Library item holding this file (status "exists").
 * @property {string} [sameAs]  Earlier file with the same content (status "repeat").
 */

/**
 * @typedef {object} ImportPlan
 * @property {string} folder
 * @property {string} folderName
 * @property {number} libraryID
 * @property {FolderFile[]} files
 * @property {LibraryIndex} index
 */

/**
 * @typedef {"imported" | "attached" | "exists" | "repeat" | "unrecognized" | "failed"} ImportStatus
 * @typedef {{ status: ImportStatus, item?: any, detail?: string }} ImportResult
 */

/**
 * @typedef {object} ImportOptions
 * @property {number | null} collectionID  Collection to import into (null: library root).
 * @property {boolean} subcollections  Mirror the folder tree as collections.
 * @property {boolean} link  Link to the files instead of copying them.
 * @property {boolean} attachToExisting
 * @property {import("./pipeline.js").Action[]} metadataActions  Run on each new item before the duplicate check.
 * @property {import("./pipeline.js").Action[]} eprintActions  Run on each new item that is kept.
 */

export class FolderImporter {
	/**
	 * @param {object} deps
	 * @param {any} deps.Zotero
	 * @param {import("./platform.js").FileStore} deps.files
	 * @param {import("./cryptobib-store.js").CryptoBibStore} deps.store
	 * @param {import("./pipeline.js").Pipeline} deps.pipeline
	 * @param {() => string} deps.eprintKey
	 * @param {() => () => void} deps.suspendAutoProcessing  Returns the function that resumes it.
	 * @param {(msg: string) => void} deps.log
	 */
	constructor({ Zotero, files, store, pipeline, eprintKey, suspendAutoProcessing, log }) {
		this.Zotero = Zotero;
		this.files = files;
		this.store = store;
		this.pipeline = pipeline;
		this.eprintKey = eprintKey;
		this.suspendAutoProcessing = suspendAutoProcessing;
		this.log = log;
	}

	/**
	 * Lists the PDFs below `folder` and checks which files the library already has.
	 * @param {string} folder
	 * @param {number} libraryID
	 * @returns {Promise<ImportPlan>}
	 */
	async scan(folder, libraryID) {
		const files = [];
		await this.#walk(folder, [], files);
		files.sort((a, b) => a.path.localeCompare(b.path));
		if (files.length > FOLDER_IMPORT.maxFiles) {
			throw new Error(`The folder contains ${files.length} PDFs; at most ${FOLDER_IMPORT.maxFiles} can be imported at once.`);
		}
		const index = await new LibraryIndex({ Zotero: this.Zotero, files: this.files, eprintKey: this.eprintKey() }).load(libraryID);
		const firstWithHash = new Map();
		for (const file of files) {
			const attachment = await index.findFile(file);
			if (attachment) {
				file.status = "exists";
				file.existing = this.#topLevel(attachment);
				continue;
			}
			const hash = await index.md5(file.path);
			if (hash && firstWithHash.has(hash)) {
				file.status = "repeat";
				file.sameAs = firstWithHash.get(hash);
				continue;
			}
			if (hash) firstWithHash.set(hash, file.path);
			file.status = "new";
		}
		return { folder, folderName: this.files.basename(folder), libraryID, files, index };
	}

	async #walk(directory, folders, found) {
		let children;
		try {
			children = await this.files.children(directory);
		}
		catch (e) {
			this.log(`Cannot list ${directory}: ${e}`);
			return;
		}
		for (const path of children) {
			const name = this.files.basename(path);
			if (name.startsWith(".")) continue;
			const stat = await this.files.stat(path).catch(() => null);
			if (stat?.type === "directory") {
				if (folders.length < FOLDER_IMPORT.maxDepth) await this.#walk(path, [...folders, name], found);
			}
			else if (stat?.type === "regular" && FOLDER_IMPORT.extensions.includes(name.split(".").pop().toLowerCase())) {
				found.push({ path, name, folders, size: stat.size, status: "new" });
			}
		}
	}

	#topLevel(item) {
		return item.parentItemID ? this.Zotero.Items.get([item.parentItemID])[0] ?? item : item;
	}

	/**
	 * Imports the files of a plan.
	 * @param {ImportPlan} plan
	 * @param {ImportOptions} options
	 * @param {{ onFileDone?: (file: FolderFile, result: ImportResult) => void, shouldStop?: () => boolean }} [hooks]
	 *   shouldStop: checked before each file; once true, the remaining files are left alone.
	 * @returns {Promise<Array<{ file: FolderFile, result: ImportResult }>>}
	 */
	async run(plan, options, { onFileDone = () => {}, shouldStop = () => false } = {}) {
		const resume = this.suspendAutoProcessing();
		const collections = new CollectionTree(this.Zotero, plan.libraryID, options.collectionID, plan.folderName, options.subcollections);
		const link = options.link && plan.libraryID === this.Zotero.Libraries.userLibraryID;
		const summary = [];
		try {
			for (const file of plan.files) {
				if (shouldStop()) break;
				/** @type {ImportResult} */
				let result;
				try {
					result = await this.#importFile(plan, file, { ...options, link }, collections);
				}
				catch (e) {
					this.log(`Importing ${file.path} failed: ${e}\n${e.stack ?? ""}`);
					result = { status: "failed", detail: String(e.message ?? e) };
				}
				onFileDone(file, result);
				summary.push({ file, result });
			}
		}
		finally {
			resume();
		}
		return summary;
	}

	/** @returns {Promise<ImportResult>} */
	async #importFile(plan, file, options, collections) {
		if (file.status === "repeat") return { status: "repeat", detail: this.files.basename(file.sameAs) };
		const collectionID = await collections.forFolders(file.folders);
		if (file.status === "exists") {
			await this.#addToCollection(file.existing, collectionID);
			return { status: "exists", item: file.existing };
		}

		const { Attachments } = this.Zotero;
		const collectionOptions = collectionID ? { collections: [collectionID] } : {};
		const attachment = options.link
			? await Attachments.linkFromFile({ file: file.path, ...collectionOptions })
			: await Attachments.importFromFile({ file: file.path, libraryID: plan.libraryID, ...collectionOptions });

		const parent = (await this.#recognize(attachment))
			?? (await this.#identifyInCryptoBib(attachment, file, plan.libraryID, collectionID));
		if (!parent) return { status: "unrecognized", item: attachment };

		await this.pipeline.run([parent], options.metadataActions);

		const existing = plan.index.findPaper(parent);
		if (existing) {
			await this.#addToCollection(existing, collectionID);
			if (options.attachToExisting && !new ItemWrapper(existing, this.Zotero).hasPDF()) {
				attachment.parentID = existing.id;
				await attachment.saveTx();
				await this.Zotero.Items.trashTx([parent.id]);
				return { status: "attached", item: existing };
			}
			await this.Zotero.Items.trashTx([attachment.id, parent.id]);
			return { status: "exists", item: existing };
		}

		plan.index.addPaper(parent);
		const detail = await this.pipeline.runOnItem(parent, options.eprintActions);
		return { status: "imported", item: parent, detail };
	}

	/** Zotero's "Retrieve Metadata for PDF"; returns the new parent item. */
	async #recognize(attachment) {
		const { RecognizeDocument, Items } = this.Zotero;
		if (!RecognizeDocument.canRecognize(attachment)) return null;
		await RecognizeDocument.recognizeItems([attachment]);
		const parentID = Items.get([attachment.id])[0]?.parentItemID;
		return parentID ? Items.get([parentID])[0] ?? null : null;
	}

	/** Creates the parent item from CryptoBib when the PDF names a paper that CryptoBib knows. */
	async #identifyInCryptoBib(attachment, file, libraryID, collectionID) {
		let index;
		try {
			index = await this.store.getIndex();
		}
		catch (e) {
			this.log(`CryptoBib unavailable for ${file.name}: ${e}`);
			return null;
		}
		let text = "";
		try {
			text = (await this.Zotero.PDFWorker.getFullText(attachment.id, FOLDER_IMPORT.textPages))?.text ?? "";
		}
		catch (e) {
			this.log(`No text from ${file.name}: ${e}`);
		}
		const record = identifyInCryptoBib(index, file.name, text);
		if (!record) return null;

		const item = await createItemFromRecord(this.Zotero, record, { libraryID, collectionIDs: collectionID ? [collectionID] : [], eprintKey: this.eprintKey() });
		attachment.parentID = item.id;
		await attachment.saveTx();
		return item;
	}

	async #addToCollection(item, collectionID) {
		// Only top-level items (regular items, standalone attachments) can be in collections.
		if (!collectionID || !item || item.parentItemID || item.inCollection(collectionID)) return;
		item.addToCollection(collectionID);
		await item.saveTx();
	}
}

/**
 * Collections mirroring the folder tree: one for the chosen folder (inside the
 * target collection) and one per subfolder. Existing collections with the
 * same name are reused, so importing a folder again does not duplicate them.
 */
class CollectionTree {
	constructor(Zotero, libraryID, baseCollectionID, folderName, mirror) {
		this.paths = new CollectionPaths(Zotero, libraryID, baseCollectionID);
		this.folderName = folderName;
		this.mirror = mirror;
	}

	/** @param {string[]} folders @returns {Promise<number | null>} */
	async forFolders(folders) {
		return this.mirror ? this.paths.resolve([this.folderName, ...folders]) : this.paths.baseCollectionID;
	}
}
