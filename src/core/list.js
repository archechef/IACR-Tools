/**
 * Reading lists: turns a pasted or imported list of papers into entries the
 * plugin can look up. Accepts ePrint ids, DOIs, CryptoBib keys, plain titles
 * and BibTeX, so that a list written by hand, exported from a bibliography or
 * produced by an assistant all work.
 *
 * A list can be split into sections by lines such as "[Signatures]" or
 * "[Signatures / Lattice]": the papers below such a line belong in that
 * subcollection of the collection the list is imported into.
 */
import { EPRINT, LIST } from "../config.js";
import { BibtexParser, MacroTable } from "./bibtex.js";
import { formatEprintId, parseEprintId } from "./eprint.js";
import { latexToText } from "./latex.js";
import { identifiersInText } from "./pdf-text.js";
import { normalizeDOI } from "./text.js";

/**
 * @typedef {object} ListEntry
 * @property {string} raw       The line (or BibTeX key) the entry came from.
 * @property {string} [eprintId]
 * @property {string} [doi]
 * @property {string} [key]     CryptoBib citation key.
 * @property {string} [title]   The line's text, when it carries no identifier.
 * @property {string} [hint]    A title given as a comment behind an identifier,
 *                              used when the identifier leads nowhere.
 * @property {string[][]} [collections]  Only in lists with sections: the
 *                              collection paths the paper is listed under
 *                              (several if it is listed in several sections;
 *                              [] is the target collection itself).
 */

/**
 * Parses a list of papers.
 * @param {string} text
 * @returns {ListEntry[]}
 */
export function parseList(text) {
	const entries = LIST.bibtexPattern.test(text ?? "") ? parseBibtex(text) : parseLines(text);
	/** @type {Map<string, ListEntry>} */
	const seen = new Map();
	const unique = [];
	for (const entry of entries) {
		const signature = entry.eprintId ?? entry.doi ?? entry.key ?? entry.title?.toLowerCase();
		if (entry.hint === undefined) delete entry.hint;
		if (!signature) continue;
		const first = seen.get(signature);
		if (first) {
			// A paper listed in two sections belongs in both collections.
			for (const path of entry.collections ?? []) addPath(first.collections, path);
			continue;
		}
		seen.set(signature, entry);
		unique.push(entry);
		if (unique.length >= LIST.maxEntries) break;
	}
	return unique;
}

/** @returns {ListEntry[]} */
function parseLines(text) {
	const entries = [];
	/** @type {string[] | null} */
	let section = null;
	for (const line of (text ?? "").split(/\r?\n/)) {
		const cleaned = line.replace(LIST.bulletPattern, "");
		const path = parseSection(cleaned);
		if (path) {
			section = path;
			continue;
		}
		// Not a section, so brackets around the line only wrap an identifier: "[2024/1234]".
		const entry = parseEntry(cleaned.replace(/^\s*\[([^[\]]*)\]\s*$/, "$1"));
		if (entry) entries.push({ ...entry, collections: [section ?? []] });
	}
	// Without sections, entries carry no collections: they go where the import goes.
	if (!section) for (const entry of entries) delete entry.collections;
	return entries;
}

/**
 * A section line: "[Topic]", "[Topic / Subtopic]" or "[Phd → Project → Topic]",
 * optionally with a comment. "[]" returns to the target collection itself. A
 * bracketed identifier such as "[2024/1234]" is a paper, not a section.
 * @param {string} line
 * @returns {string[] | null} the collection path
 */
export function parseSection(line) {
	const comment = LIST.commentPattern.exec(line ?? "");
	const text = (comment ? line.slice(0, comment.index) : line ?? "").trim();
	const match = LIST.sectionPattern.exec(text);
	if (!match) return null;
	const entry = parseEntry(match[1]);
	if (entry && !entry.title) return null;
	return match[1].split(LIST.sectionSeparator).map((name) => name.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** Adds a collection path unless it is already there (names compared as Zotero users see them). */
function addPath(paths, path) {
	const key = (p) => JSON.stringify(p.map(collectionNameKey));
	if (paths && !paths.some((p) => key(p) === key(path))) paths.push(path);
}

/**
 * Collection names are compared without regard to case and spacing, so
 * "Lattice signatures" in a list finds the collection "Lattice Signatures".
 * @param {string} name
 */
export function collectionNameKey(name) {
	return name.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * A section's path relative to the collection the list is imported into. The
 * path may repeat that collection and its parents ("Phd → Project → Topic"
 * imported into "Phd → Project"); that part is dropped, so a list works
 * whether it names the full path or only the topic.
 * @param {string[]} path
 * @param {string[]} basePath  Names from the library root to the target collection.
 * @returns {string[]}
 */
export function relativeCollectionPath(path, basePath) {
	const same = (a, b) => collectionNameKey(a) === collectionNameKey(b);
	for (let length = Math.min(path.length, basePath.length); length > 0; length--) {
		const tail = basePath.slice(basePath.length - length);
		if (tail.every((name, i) => same(name, path[i]))) return path.slice(length);
	}
	return path;
}

/**
 * One line: an identifier anywhere in the line wins over its text, so
 * "Bernstein 2008 (eprint.iacr.org/2008/045)" and a bare id both work.
 * @param {string} line
 * @returns {ListEntry | null}
 */
export function parseEntry(line) {
	const comment = LIST.commentPattern.exec(line ?? "");
	const raw = (comment ? line.slice(0, comment.index) : line ?? "").trim();
	if (!raw) return null;
	const hint = cleanTitle(comment?.[1] ?? "") || undefined;
	const eprintId = parseEprintId(raw);
	if (eprintId) return { raw, eprintId, hint };
	const { dois } = identifiersInText(raw);
	if (dois.length) return { raw, doi: dois[0], hint };
	const key = LIST.keyPattern.exec(raw)?.[1];
	if (key) return { raw, key, hint };
	const title = cleanTitle(raw);
	return title.length > 1 ? { raw, title } : null;
}

/** Drops a trailing "— Authors, 2019" annotation. */
function cleanTitle(text) {
	return text.replace(LIST.titleAnnotation, "").trim();
}

/** @returns {ListEntry[]} */
function parseBibtex(text) {
	const macros = new MacroTable();
	const parser = new BibtexParser(text, { onString: (name, value) => macros.define(name, value) });
	const entries = [];
	for (const entry of parser.entries()) {
		const field = (name) => macros.resolve(entry.fields[name])?.trim();
		const eprintId = eprintIdOfBibtex(field);
		const doi = normalizeDOI(field("doi"));
		const title = latexToText(field("title") ?? "").trim();
		const key = LIST.keyPattern.exec(entry.key) ? entry.key : undefined;
		if (eprintId || doi || key || title) entries.push({ raw: entry.key || title, eprintId, doi: doi || undefined, key, title: title || undefined });
	}
	return entries;
}

/** ePrint id of a BibTeX entry: from `eprint`, `url`, `howpublished` or `note`. */
function eprintIdOfBibtex(field) {
	const bare = field("eprint");
	if (bare && /^\d{4}\/\d{1,5}$/.test(bare)) {
		const [year, number] = bare.split("/");
		return formatEprintId(year, number);
	}
	for (const name of ["eprint", "url", "howpublished", "note", "archiveprefix"]) {
		const value = field(name);
		const id = value && (value.toLowerCase().includes("eprint") || EPRINT.idPattern.test(value)) ? parseEprintId(value) : null;
		if (id) return id;
	}
	return undefined;
}
