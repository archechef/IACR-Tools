/**
 * CryptoBib records and the in-memory index used to look them up.
 *
 * A {@link CryptoBibRecord} is a CryptoBib entry whose `@string` macros have been
 * resolved against one abbreviation file. Records are serializable, so the
 * store can cache them as JSON instead of re-parsing the 40 MB BibTeX file.
 */
import { CRYPTOBIB, TIMING } from "../config.js";
import { BibtexParser, singleMacroName } from "./bibtex.js";
import { parseEprintId } from "./eprint.js";
import { latexToText } from "./latex.js";
import { bestMatch } from "./matching.js";
import { lastNameKey, normalizeDOI, parseBibtexName, splitBibtexNames, titleKey } from "./text.js";

/**
 * @typedef {object} CryptoBibRecord
 * @property {string} key        CryptoBib citation key, e.g. "EC:Bernstein08".
 * @property {string} type       Lower-case BibTeX entry type.
 * @property {Record<string, string>} fields Resolved (still LaTeX-encoded) field values.
 * @property {string} [conference] Short conference label, e.g. "EUROCRYPT 2008".
 * @property {string} title      Plain-text title (for matching).
 * @property {string[]} authors  Author last names (for matching).
 * @property {number} [year]
 * @property {string} [doi]      Normalized DOI.
 */

/**
 * Derives the conference label from the booktitle macro, following CryptoBib's
 * naming convention ("eurocrypt08name2" → "eurocrypt08key2" → "EUROCRYPT 2008").
 * @param {import("./bibtex.js").BibValue | undefined} bookTitle
 * @param {import("./bibtex.js").MacroTable} macros
 */
function conferenceLabel(bookTitle, macros) {
	const macro = singleMacroName(bookTitle);
	const match = macro && CRYPTOBIB.bookTitleMacro.exec(macro);
	if (!match) return undefined;
	const keyMacro = CRYPTOBIB.conferenceKeyMacro(match[1], match[2]);
	if (!macros.has(keyMacro)) return undefined;
	return latexToText(macros.get(keyMacro)).replace(CRYPTOBIB.conferencePartSuffix, "") || undefined;
}

/**
 * @param {import("./bibtex.js").BibEntry} entry
 * @param {import("./bibtex.js").MacroTable} macros
 * @returns {CryptoBibRecord}
 */
export function toRecord(entry, macros) {
	/** @type {Record<string, string>} */
	const fields = {};
	for (const [name, value] of Object.entries(entry.fields)) {
		const resolved = macros.resolve(value)?.trim();
		if (resolved) fields[name] = resolved;
	}
	const year = Number.parseInt(fields.year, 10);
	return {
		key: entry.key,
		type: entry.type,
		fields,
		conference: conferenceLabel(entry.fields.booktitle, macros),
		title: latexToText(fields.title),
		authors: splitBibtexNames(fields.author).map((name) => parseBibtexName(name).lastName),
		year: Number.isFinite(year) ? year : undefined,
		doi: normalizeDOI(fields.doi) || undefined,
	};
}

/**
 * Parses CryptoBib into records, yielding to the event loop periodically.
 * @param {string} bibText Contents of crypto.bib.
 * @param {import("./bibtex.js").MacroTable} macros Macros from an abbrevN.bib file.
 * @param {object} [options]
 * @param {() => Promise<void>} [options.yieldControl] Called every `chunkSize` entries.
 * @param {number} [options.chunkSize]
 * @returns {Promise<CryptoBibRecord[]>}
 */
export async function buildRecords(bibText, macros, { yieldControl, chunkSize = TIMING.parseChunkSize } = {}) {
	const records = [];
	for (const entry of new BibtexParser(bibText).entries()) {
		records.push(toRecord(entry, macros));
		if (yieldControl && records.length % chunkSize === 0) await yieldControl();
	}
	return records;
}

/** Whether a record is an ePrint archive entry. */
export function isEprintRecord(record) {
	return record.key.startsWith(CRYPTOBIB.eprintKeyPrefix);
}

/** Appends a value to a Map of arrays. */
function push(map, key, value) {
	if (!key) return;
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}

/** Title / author / DOI lookup tables over one pool of records. */
class RecordPool {
	/** @type {Map<string, CryptoBibRecord>} */ byDOI = new Map();
	/** @type {Map<string, CryptoBibRecord[]>} */ byTitle = new Map();
	/** @type {Map<string, CryptoBibRecord[]>} */ byAuthor = new Map();

	/** @param {CryptoBibRecord} record */
	add(record) {
		if (record.doi) this.byDOI.set(record.doi, record);
		push(this.byTitle, titleKey(record.title), record);
		for (const author of new Set(record.authors.map(lastNameKey))) push(this.byAuthor, author, record);
	}

	/**
	 * Candidates sharing the DOI, the exact title, or an author with the query.
	 * @param {import("./matching.js").Reference} query
	 */
	candidates(query) {
		const doi = normalizeDOI(query.doi);
		const byDOI = doi && this.byDOI.get(doi);
		if (byDOI) return [byDOI];
		const found = new Set(this.byTitle.get(titleKey(query.title)) ?? []);
		for (const author of query.authors ?? []) {
			for (const record of this.byAuthor.get(lastNameKey(author)) ?? []) found.add(record);
		}
		return found;
	}
}

export class CryptoBibIndex {
	#byKey = new Map();
	#publications = new RecordPool();
	#eprints = new RecordPool();
	/** @type {Map<string, CryptoBibRecord>} ePrint id → ePrint record */
	#eprintsById = new Map();

	/** @param {CryptoBibRecord[]} records */
	constructor(records) {
		for (const record of records) {
			this.#byKey.set(record.key, record);
			if (isEprintRecord(record)) {
				this.#eprints.add(record);
				const id = parseEprintId(record.fields.url) ?? parseEprintId(record.fields.howpublished);
				if (id) this.#eprintsById.set(id, record);
			}
			else {
				this.#publications.add(record);
			}
		}
	}

	get size() {
		return this.#byKey.size;
	}

	/** @returns {CryptoBibRecord | undefined} */
	getByKey(key) {
		return this.#byKey.get(key);
	}

	/**
	 * The ePrint entry with the given id ("2008/045").
	 * @returns {CryptoBibRecord | undefined}
	 */
	getEprint(id) {
		return this.#eprintsById.get(id);
	}

	/**
	 * The published (non-ePrint) entry with the given DOI.
	 * @returns {CryptoBibRecord | undefined}
	 */
	getPublicationByDOI(doi) {
		return this.#publications.byDOI.get(normalizeDOI(doi));
	}

	/**
	 * Finds the published (non-ePrint) version of a reference.
	 * @param {import("./matching.js").Reference} query
	 * @param {import("./matching.js").MatchOptions} [options] e.g. `{ yearTolerance: null }`
	 *   for a preprint, which may predate its publication by years.
	 */
	findPublication(query, options) {
		return bestMatch(query, this.#publications.candidates(query), options);
	}

	/**
	 * Finds the ePrint version of a reference. ePrint versions may predate or
	 * follow the publication by years, so the year is not compared.
	 * @param {import("./matching.js").Reference} query
	 */
	findEprint(query) {
		return bestMatch({ ...query, doi: undefined }, this.#eprints.candidates(query), { yearTolerance: null });
	}
}
