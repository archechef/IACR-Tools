/**
 * Sources that can locate the IACR ePrint version of a paper. Each source turns
 * its hits into {@link Reference}s and relies on {@link bestMatch}; sources are
 * queried in order until one succeeds.
 */
import { DBLP, EPRINT } from "../config.js";
import { parseEprintId } from "../core/eprint.js";
import { eprintIdOf } from "../core/mapping.js";
import { bestMatch } from "../core/matching.js";
import { normalizeText, parseDisplayName } from "../core/text.js";

/**
 * @typedef {object} EprintHit
 * @property {string} id      ePrint id, e.g. "2008/045".
 * @property {string} title
 * @property {string} source  Name of the source that found it.
 */

/**
 * @typedef {object} EprintSource
 * @property {string} name
 * @property {(ref: import("../core/matching.js").Reference) => Promise<EprintHit | null>} find
 */

/** Matching options for ePrint lookups: versions can be years apart. */
const EPRINT_MATCH = Object.freeze({ yearTolerance: null });

/** Drops the DOI: the ePrint version never shares the publication's DOI. */
const withoutDOI = (ref) => ({ ...ref, doi: undefined });

/** Query string for full-text search engines: the plain title. */
const searchQuery = (ref) => normalizeText(ref.title);

/** @returns {EprintSource} */
export function cryptoBibSource(store) {
	return {
		name: "CryptoBib",
		async find(ref) {
			const match = (await store.getIndex()).findEprint(ref);
			const id = match && eprintIdOf(match.candidate);
			return id ? { id, title: match.candidate.title, source: this.name } : null;
		},
	};
}

/**
 * dblp indexes the ePrint archive with structured metadata (authors, year).
 * @param {import("./platform.js").Http} http
 * @returns {EprintSource}
 */
export function dblpSource(http) {
	return {
		name: "dblp",
		async find(ref) {
			const json = await http.getJSON(DBLP.searchURL(searchQuery(ref), DBLP.maxHits));
			const hits = [json?.result?.hits?.hit ?? []].flat();
			const candidates = hits
				.map((hit) => hit.info ?? {})
				.filter((info) => DBLP.eprintVenue.test(info.venue ?? "") || parseEprintId(eprintLink(info)))
				.map((info) => ({
					id: parseEprintId(eprintLink(info)) ?? dblpVolumeId(info),
					title: (info.title ?? "").replace(/\.$/, ""),
					authors: [info.authors?.author ?? []].flat().map((a) => parseDisplayName(a.text ?? a).lastName),
					year: Number(info.year) || undefined,
				}))
				.filter((candidate) => candidate.id);
			const match = bestMatch(withoutDOI(ref), candidates, EPRINT_MATCH);
			return match ? { id: match.candidate.id, title: match.candidate.title, source: this.name } : null;
		},
	};
}

/** dblp's "ee" is a string or a list of strings. */
function eprintLink(info) {
	return [info.ee ?? []].flat().find((url) => parseEprintId(url)) ?? "";
}

/** dblp stores ePrint papers as volume = year, pages = number. */
function dblpVolumeId(info) {
	return /^\d{4}$/.test(info.volume ?? "") && /^\d+$/.test(info.pages ?? "")
		? parseEprintId(`${info.volume}/${info.pages}`)
		: null;
}

/**
 * The archive's own full-text search. Results carry no authors, so a stricter
 * title similarity applies (see {@link bestMatch}).
 * @param {import("./platform.js").Http} http
 * @returns {EprintSource}
 */
export function iacrSearchSource(http) {
	const { row, title, link } = EPRINT.searchSelectors;
	return {
		name: "IACR ePrint search",
		async find(ref) {
			const doc = await http.getDocument(EPRINT.searchURL(searchQuery(ref)));
			const candidates = [...doc.querySelectorAll(row)]
				.map((element) => ({
					id: parseEprintId(element.querySelector(link)?.getAttribute("href")?.replace(/^\//, "") ?? ""),
					title: element.querySelector(title)?.textContent?.trim() ?? "",
					authors: [],
				}))
				.filter((candidate) => candidate.id && candidate.title);
			const match = bestMatch({ ...withoutDOI(ref), authors: [] }, candidates, EPRINT_MATCH);
			return match ? { id: match.candidate.id, title: match.candidate.title, source: this.name } : null;
		},
	};
}

/**
 * Queries sources in order; a failing source is logged and skipped.
 */
export class EprintFinder {
	/**
	 * @param {() => EprintSource[]} sources Evaluated per lookup so preference changes apply immediately.
	 * @param {(msg: string) => void} log
	 */
	constructor(sources, log) {
		this.sources = sources;
		this.log = log;
	}

	/** @returns {Promise<EprintHit | null>} */
	async find(ref) {
		for (const source of this.sources()) {
			try {
				const hit = await source.find(ref);
				if (hit) return hit;
			}
			catch (e) {
				this.log(`ePrint source ${source.name} failed: ${e}`);
			}
		}
		return null;
	}
}
