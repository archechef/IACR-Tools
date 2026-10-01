/**
 * Writing a reading list: the counterpart of {@link module:core/list}. The
 * output is exactly what the list import reads back, so papers can travel from
 * Zotero to a chat and back.
 */
import { LIST } from "../config.js";

/**
 * @typedef {object} ListPaper
 * @property {string} [eprintId]
 * @property {string} [doi]
 * @property {string} [key]    CryptoBib citation key.
 * @property {string} [title]
 */

/**
 * One line: the strongest identifier, with the title as a comment behind it.
 * A paper with no identifier becomes its bare title (which the import looks up).
 * @param {ListPaper} paper
 * @returns {string | null}
 */
export function paperLine({ eprintId, doi, key, title }) {
	const identifier = eprintId || doi || key || "";
	const comment = commentText(title);
	if (!identifier) return comment || null;
	return comment ? `${identifier}${" ".repeat(Math.max(1, LIST.identifierWidth - identifier.length))}# ${comment}` : identifier;
}

/**
 * @param {ListPaper[]} papers
 * @param {{ header?: string }} [options]
 * @returns {string}
 */
export function formatList(papers, { header } = {}) {
	const lines = papers.map(paperLine).filter(Boolean);
	return [...(header ? [`# ${commentText(header)}`] : []), ...lines].join("\n") + (lines.length ? "\n" : "");
}

/** Titles are one-line comments here, so line breaks and "#" have to go. */
function commentText(title) {
	const text = (title ?? "").replace(/\s+/g, " ").replace(/#/g, "").trim();
	return text.length > LIST.maxCommentLength ? `${text.slice(0, LIST.maxCommentLength - 1).trimEnd()}…` : text;
}
