/**
 * Reading lists: turns a pasted or imported list of papers into entries the
 * plugin can look up. Accepts ePrint ids, DOIs, CryptoBib keys, plain titles
 * and BibTeX, so that a list written by hand, exported from a bibliography or
 * produced by an assistant all work.
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
 */

/**
 * Parses a list of papers.
 * @param {string} text
 * @returns {ListEntry[]}
 */
export function parseList(text) {
	const entries = LIST.bibtexPattern.test(text ?? "") ? parseBibtex(text) : parseLines(text);
	const seen = new Set();
	const unique = [];
	for (const entry of entries) {
		const signature = entry.eprintId ?? entry.doi ?? entry.key ?? entry.title?.toLowerCase();
		if (entry.hint === undefined) delete entry.hint;
		if (!signature || seen.has(signature)) continue;
		seen.add(signature);
		unique.push(entry);
		if (unique.length >= LIST.maxEntries) break;
	}
	return unique;
}

/** @returns {ListEntry[]} */
function parseLines(text) {
	const entries = [];
	for (const line of (text ?? "").split(/\r?\n/)) {
		const entry = parseEntry(line.replace(LIST.bulletPattern, ""));
		if (entry) entries.push(entry);
	}
	return entries;
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
