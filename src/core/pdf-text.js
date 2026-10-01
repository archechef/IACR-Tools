/**
 * Identifiers found in a PDF's file name or first pages. Used when Zotero's
 * own recognizer cannot identify a paper, so that CryptoBib can step in.
 */
import { FOLDER_IMPORT } from "../config.js";
import { formatEprintId } from "./eprint.js";
import { normalizeDOI, titleKey } from "./text.js";

/**
 * ePrint id encoded in a file name, e.g. "2008-045.pdf" → "2008/045".
 * @param {string} fileName
 * @returns {string | null}
 */
export function eprintIdFromFileName(fileName) {
	const match = FOLDER_IMPORT.eprintFilePattern.exec(fileName);
	return match ? formatEprintId(match[1], match[2]) : null;
}

/**
 * DOIs and ePrint ids mentioned in a text, in order of appearance, without duplicates.
 * @param {string} text
 * @returns {{ dois: string[], eprintIds: string[] }}
 */
export function identifiersInText(text) {
	const source = text ?? "";
	const dois = [...source.matchAll(FOLDER_IMPORT.doiTextPattern)]
		.map((m) => normalizeDOI(trimDOI(m[0])))
		.filter(Boolean);
	const eprintIds = [...source.matchAll(FOLDER_IMPORT.eprintTextPattern)]
		.map((m) => formatEprintId(m[1], m[2]));
	return { dois: [...new Set(dois)], eprintIds: [...new Set(eprintIds)] };
}

/** Drops sentence punctuation and closing brackets that are not part of a DOI found in text. */
function trimDOI(doi) {
	const count = (text, char) => text.split(char).length - 1;
	let trimmed = doi;
	for (;;) {
		const before = trimmed;
		trimmed = trimmed.replace(/[.,;:'"]+$/, "");
		for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"], ["<", ">"]]) {
			if (trimmed.endsWith(close) && count(trimmed, open) < count(trimmed, close)) trimmed = trimmed.slice(0, -1);
		}
		if (trimmed === before) return trimmed;
	}
}

/**
 * Whether a title occurs in a text. Both are compared as compact keys, so line
 * breaks, hyphenation, case, accents and punctuation do not matter. This
 * confirms that an identifier found in a paper is the paper's own and not one
 * of its references.
 * @param {string} text
 * @param {string} title
 */
export function textContainsTitle(text, title) {
	const key = titleKey(title);
	return key.length > 0 && titleKey(text).includes(key);
}

/**
 * Identifies a PDF in CryptoBib from its file name and text. Identifiers taken
 * from the text must be confirmed by the record's title appearing in the text;
 * an ePrint id in the file name is trusted when there is no text to check.
 * Order of preference: a DOI in the text, the file name's ePrint id, an ePrint
 * id in the text.
 * @param {import("./cryptobib.js").CryptoBibIndex} index
 * @param {string} fileName
 * @param {string} text  First pages of the PDF ("" if unavailable).
 * @returns {import("./cryptobib.js").CryptoBibRecord | null}
 */
export function identifyInCryptoBib(index, fileName, text) {
	const confirmed = (record) => record && textContainsTitle(text, record.title);
	const { dois, eprintIds } = identifiersInText(text);
	for (const doi of dois) {
		const record = index.getPublicationByDOI(doi);
		if (confirmed(record)) return record;
	}
	const nameId = eprintIdFromFileName(fileName);
	const byName = nameId && index.getEprint(nameId);
	if (byName && (!text.trim() || confirmed(byName))) return byName;
	for (const id of eprintIds) {
		const record = index.getEprint(id);
		if (confirmed(record)) return record;
	}
	return null;
}
