/**
 * Thin adapters over the host platform (network and file system). The rest of
 * the plugin depends on these interfaces only, which keeps it testable outside
 * Zotero.
 */
import { NETWORK, PROJECT_FOLDER } from "../config.js";

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
 * @property {(path: string) => Promise<void>} remove  A file or an empty folder; nothing if it is missing.
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
		// Not recursive: a folder with something in it is never removed.
		remove: (path) => IOUtils.remove(path, { ignoreAbsent: true }),
		children: (path) => IOUtils.getChildren(path),
		basename: (path) => PathUtils.filename(path),
		md5: (path) => Zotero.Utilities.Internal.md5Async(path),
	};
}

/**
 * Creates a link `link` that shows the folder `target`. On Windows a directory
 * junction (`mklink /J`), which unlike a symbolic link needs no admin rights
 * or developer mode; elsewhere a symbolic link. Gecko has no API for either,
 * so the system's own command runs.
 * @returns {(link: string, target: string) => Promise<void>}
 */
export function createLinkMaker({ Zotero, Services }) {
	return async (link, target) => {
		if (Zotero.isWin) {
			let shell = "";
			try {
				shell = Services.env.get("ComSpec");
			}
			catch {
				// Services.env is missing in older Gecko versions; cmd.exe has a fixed home.
			}
			await Zotero.Utilities.Internal.exec(shell || PROJECT_FOLDER.windowsShell, ["/c", "mklink", "/J", link, target]);
		}
		else {
			await Zotero.Utilities.Internal.exec(PROJECT_FOLDER.symlinkCommand, ["-s", target, link]);
		}
	};
}
