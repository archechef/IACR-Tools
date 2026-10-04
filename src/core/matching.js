/**
 * Source-independent matching of bibliographic records. Every lookup in the
 * plugin (CryptoBib, dblp, ePrint search) reduces its hits to {@link Reference}
 * objects and lets {@link bestMatch} decide.
 */
import { MATCHING } from "../config.js";
import { authorOverlap, normalizeDOI, titleExtends, titleKey, titleSimilarity } from "./text.js";

/**
 * @typedef {object} Reference
 * @property {string} title      Plain-text title.
 * @property {string[]} authors  Author last names.
 * @property {number} [year]
 * @property {string} [doi]
 */

/**
 * @typedef {object} MatchOptions
 * @property {number | null} [yearTolerance] Max. year difference; null disables the check.
 */

/**
 * @template T
 * @typedef {object} Match
 * @property {T} candidate
 * @property {number} score       In [0, 1]; 1 for exact DOI or exact title + authors.
 * @property {"doi" | "title" | "fuzzy-title"} method
 */

/**
 * Scores a candidate against a query, or returns null when it is not acceptable.
 * @param {Reference} query
 * @param {Reference} candidate
 * @param {MatchOptions} [options]
 * @returns {Omit<Match<Reference>, "candidate"> | null}
 */
export function scoreCandidate(query, candidate, { yearTolerance = MATCHING.yearTolerance } = {}) {
	const queryDOI = normalizeDOI(query.doi);
	if (queryDOI && queryDOI === normalizeDOI(candidate.doi)) {
		return { score: 1, method: "doi" };
	}
	if (yearTolerance !== null && query.year && candidate.year
		&& Math.abs(query.year - candidate.year) > yearTolerance) {
		return null;
	}

	const overlap = authorOverlap(query.authors ?? [], candidate.authors ?? []);
	// Short titles ("Short E-Cash") are only trusted when identical and backed by authors.
	const isShort = titleKey(query.title).length < MATCHING.minTitleLength;
	if (overlap === null ? isShort : overlap < MATCHING.authorOverlap) return null;
	const requiredSimilarity = isShort ? 1
		: overlap === null ? MATCHING.titleSimilarityWithoutAuthors
		: MATCHING.titleSimilarity;
	const extendsTitle = overlap !== null && titleExtends(query.title, candidate.title);
	// Cheap rejection first: most candidates of a library scan are nowhere near.
	if (!extendsTitle && similarityBound(query.title, candidate.title) < requiredSimilarity) return null;
	const similarity = extendsTitle
		? Math.max(MATCHING.titleSimilarity, titleSimilarity(query.title, candidate.title))
		: titleSimilarity(query.title, candidate.title);
	if (similarity < requiredSimilarity) return null;
	if (similarity < 1 && !extendsTitle && overlap !== null && overlap < MATCHING.fuzzyTitleAuthorOverlap) return null;

	const score = overlap === null ? similarity : (similarity + overlap) / 2;
	return { score, method: similarity === 1 ? "title" : "fuzzy-title" };
}

/**
 * Upper bound of {@link titleSimilarity} from the key lengths alone: at most
 * min(|x|, |y|) - 1 bigrams can be shared.
 */
function similarityBound(a, b) {
	const x = titleKey(a).length;
	const y = titleKey(b).length;
	if (x === y) return 1;
	return (2 * (Math.min(x, y) - 1)) / (x + y - 2);
}

/**
 * Returns the best acceptable candidate.
 * @template {Reference} T
 * @param {Reference} query
 * @param {Iterable<T>} candidates
 * @param {MatchOptions} [options]
 * @returns {Match<T> | null}
 */
export function bestMatch(query, candidates, options) {
	/** @type {Match<T> | null} */
	let best = null;
	for (const candidate of candidates) {
		const result = scoreCandidate(query, candidate, options);
		if (!result) continue;
		const yearDistance = (c) => Math.abs((query.year ?? 0) - (c.year ?? 0));
		if (!best || result.score > best.score
			|| (result.score === best.score && yearDistance(candidate) < yearDistance(best.candidate))) {
			best = { candidate, ...result };
		}
		if (best.score === 1 && best.method === "doi") break;
	}
	return best;
}
