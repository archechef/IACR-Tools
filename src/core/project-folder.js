/**
 * Paths for linking a project folder to its Zotero collection: the folder
 * ZotMoov files a collection's PDFs in, and comparing paths.
 */
import { ZOTMOOV } from "../config.js";

/**
 * A collection name as ZotMoov turns it into a folder name (its copy of
 * node-sanitize-filename, with "_" for every character Windows forbids).
 * @param {string} name
 */
export function zotmoovFolderName(name) {
	return name
		.replace(/[/?<>\\:*|"]/g, "_")
		.replace(/[\x00-\x1f\x80-\x9f]/g, "_")
		.replace(/^\.+$/, "_")
		.replace(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i, "_")
		.replace(/[. ]+$/, "_");
}

/**
 * The folders below ZotMoov's directory that `{%c}` gives for a collection,
 * from the top-level collection down. ZotMoov follows at most
 * `maxCollectionDepth` levels, the deepest ones.
 * @param {string[]} names  Collection names from the top level down to the collection.
 */
export function zotmoovCollectionFolders(names) {
	return names.slice(-ZOTMOOV.maxCollectionDepth).map(zotmoovFolderName);
}

/**
 * Whether two paths name the same place, ignoring the kind of slash and a
 * trailing one (and case, where the file system ignores it).
 * @param {string} a
 * @param {string} b
 * @param {{ ignoreCase?: boolean }} [options]
 */
export function samePath(a, b, { ignoreCase = false } = {}) {
	const normal = (path) => {
		const plain = String(path ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
		return ignoreCase ? plain.toLowerCase() : plain;
	};
	return Boolean(a) && Boolean(b) && normal(a) === normal(b);
}
