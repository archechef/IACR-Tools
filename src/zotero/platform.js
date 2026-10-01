/**
 * Thin adapters over the host platform (network and file system). The rest of
 * the plugin depends on these interfaces only, which keeps it testable outside
 * Zotero.
 */
import { NETWORK } from "../config.js";

/**
 * @typedef {object} Http
 * @property {(url: string, options?: {timeout?: number}) => Promise<string>} getText
 * @property {(url: string) => Promise<any>} getJSON
 * @property {(url: string) => Promise<Document>} getDocument
 */

/**
 * @typedef {object} FileStore
 * @property {(...parts: string[]) => string} join
 * @property {(path: string) => Promise<boolean>} exists
 * @property {(path: string) => Promise<string>} readText
 * @property {(path: string, text: string) => Promise<void>} writeText
 * @property {(path: string) => Promise<void>} makeDirectory
 * @property {(path: string) => Promise<{ type: "regular" | "directory" | "other", size: number }>} stat
 * @property {(path: string) => Promise<string[]>} children  Absolute paths of a directory's entries.
 * @property {(path: string) => string} basename
 * @property {(path: string) => Promise<string | false>} md5  Hex MD5 of a file; false if it is missing.
 */

/** @returns {Http} */
export function createZoteroHttp(Zotero) {
	const request = (url, options) => Zotero.HTTP.request("GET", url, {
		timeout: NETWORK.timeoutMs,
		errorDelayMax: NETWORK.errorDelayMaxMs,
		...options,
	});
	return {
		async getText(url, { timeout } = {}) {
			const xhr = await request(url, { responseType: "text", ...(timeout && { timeout }) });
			return xhr.responseText;
		},
		async getJSON(url) {
			const xhr = await request(url, { responseType: "json", headers: { Accept: "application/json" } });
			return xhr.response;
		},
		async getDocument(url) {
			const xhr = await request(url, { responseType: "document" });
			return xhr.response;
		},
	};
}

/**
 * File access through Gecko's IOUtils / PathUtils.
 * @returns {FileStore}
 */
export function createGeckoFileStore({ IOUtils, PathUtils, Zotero }) {
	return {
		join: (...parts) => PathUtils.join(...parts),
		exists: (path) => IOUtils.exists(path),
		readText: (path) => IOUtils.readUTF8(path),
		async writeText(path, text) {
			// Write atomically so an interrupted download never leaves a truncated cache.
			await IOUtils.writeUTF8(path, text, { tmpPath: `${path}.tmp` });
		},
		async makeDirectory(path) {
			await IOUtils.makeDirectory(path, { ignoreExisting: true, createAncestors: true });
		},
		async stat(path) {
			const { type, size } = await IOUtils.stat(path);
			return { type, size };
		},
		children: (path) => IOUtils.getChildren(path),
		basename: (path) => PathUtils.filename(path),
		md5: (path) => Zotero.Utilities.Internal.md5Async(path),
	};
}
