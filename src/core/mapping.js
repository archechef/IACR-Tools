/**
 * Declarative mapping from CryptoBib records to Zotero item data. The result is
 * a plain object that the Zotero layer applies to an item; nothing here depends
 * on the Zotero API.
 */
import { latexToText } from "./latex.js";
import { parseEprintId } from "./eprint.js";
import { isEprintRecord } from "./cryptobib.js";
import { normalizeDOI, normalizePages, parseBibtexName, splitBibtexNames } from "./text.js";

/** BibTeX entry type → Zotero item type. */
export const ITEM_TYPES = Object.freeze({
	inproceedings: "conferencePaper",
	article: "journalArticle",
	incollection: "bookSection",
	book: "book",
	techreport: "report",
	misc: "preprint",
	unpublished: "manuscript",
	manual: "document",
});

const text = (value) => latexToText(value);
const richText = (value) => latexToText(value, { rich: true });

/**
 * One row per Zotero field. `zotero` lists candidate fields in order of
 * preference; the first one valid for the item type is used. Base fields such as
 * `publicationTitle` resolve to the type-specific field (e.g. `proceedingsTitle`).
 * @type {ReadonlyArray<{ zotero: string[], from: (record: import("./cryptobib.js").CryptoBibRecord) => string | undefined }>}
 */
export const FIELD_MAP = Object.freeze([
	{ zotero: ["title"], from: (r) => richText(r.fields.title) },
	{ zotero: ["publicationTitle"], from: (r) => text(r.fields.booktitle ?? r.fields.journal) },
	{ zotero: ["conferenceName"], from: (r) => r.conference },
	{ zotero: ["volume"], from: (r) => text(r.fields.volume) },
	{ zotero: ["issue"], from: (r) => text(r.fields.number) },
	{ zotero: ["pages"], from: (r) => normalizePages(text(r.fields.pages)) },
	{ zotero: ["series"], from: (r) => text(r.fields.series) },
	{ zotero: ["publisher"], from: (r) => text(r.fields.publisher ?? r.fields.institution) },
	// CryptoBib's "address" is the venue of the conference, not the publisher's seat.
	{ zotero: ["eventPlace", "place"], from: (r) => text(r.fields.address) },
	{ zotero: ["date"], from: (r) => formatDate(r) },
	{ zotero: ["DOI"], from: (r) => normalizeDOI(r.fields.doi) || undefined },
	{ zotero: ["ISBN"], from: (r) => text(r.fields.isbn) },
	{ zotero: ["ISSN"], from: (r) => text(r.fields.issn) },
	{ zotero: ["url"], from: (r) => r.fields.url },
]);

const MONTHS = ["january", "february", "march", "april", "may", "june", "july",
	"august", "september", "october", "november", "december"];

/** "2008" + "April~13--17," → "2008-04". */
export function formatDate(record) {
	const year = record.year;
	if (!year) return undefined;
	const monthWord = normalizeMonth(record.fields.month);
	const month = MONTHS.findIndex((m) => monthWord && m.startsWith(monthWord));
	return month < 0 ? String(year) : `${year}-${String(month + 1).padStart(2, "0")}`;
}

function normalizeMonth(month) {
	const word = latexToText(month).toLowerCase().match(/[a-z]{3,}/);
	return word ? word[0].slice(0, 3) : null;
}

/**
 * @typedef {object} ZoteroCreator
 * @property {string} firstName
 * @property {string} lastName
 * @property {"author" | "editor"} creatorType
 * @property {1} [fieldMode]
 */

/** @returns {ZoteroCreator[]} */
export function creatorsOf(record) {
	const people = (field, creatorType) =>
		splitBibtexNames(record.fields[field]).map((name) => ({ ...parseBibtexName(name), creatorType }));
	return [...people("author", "author"), ...people("editor", "editor")];
}

/**
 * @typedef {object} ZoteroData
 * @property {string} itemType
 * @property {Array<{ candidates: string[], value: string }>} fields
 * @property {ZoteroCreator[]} creators
 * @property {string} citationKey
 * @property {string | null} eprintId  Set when the record is an ePrint entry.
 */

/**
 * @param {import("./cryptobib.js").CryptoBibRecord} record
 * @returns {ZoteroData}
 */
export function toZoteroData(record) {
	const fields = [];
	for (const { zotero, from } of FIELD_MAP) {
		const value = from(record);
		if (value) fields.push({ candidates: zotero, value });
	}
	return {
		itemType: ITEM_TYPES[record.type] ?? "document",
		fields,
		creators: creatorsOf(record),
		citationKey: record.key,
		eprintId: isEprintRecord(record) ? eprintIdOf(record) : null,
	};
}

/** Extracts the ePrint id of a CryptoBib ePrint record from its URL or "howpublished". */
export function eprintIdOf(record) {
	return parseEprintId(record.fields.url) ?? parseEprintId(record.fields.howpublished);
}

