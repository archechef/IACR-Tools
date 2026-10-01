/**
 * Text normalization, similarity and person-name helpers used for matching
 * records coming from different sources (Zotero, CryptoBib, dblp, ePrint).
 */
import { MATCHING } from "../config.js";
import { latexToText } from "./latex.js";

const COMBINING_MARKS = /[\u0300-\u036f]/g;
const HTML_TAGS = /<[^>]+>/g;
const PARTICLES = new Set(MATCHING.nameParticles);

/** Lower-cases, strips accents, markup and punctuation; collapses whitespace. */
export function normalizeText(text) {
	return (text ?? "")
		.replace(HTML_TAGS, " ")
		.normalize("NFKD")
		.replace(COMBINING_MARKS, "")
		.toLowerCase()
		.replace(/ß/g, "ss")
		.replace(/[øœæłđı]/g, (c) => ({ ø: "o", œ: "oe", æ: "ae", ł: "l", đ: "d", ı: "i" })[c])
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

/**
 * Key used for exact title lookups. Version notes such as "(Extended Abstract)"
 * are dropped and spaces removed, so that "Rabin-Williams", "Rabin Williams" and
 * "RabinWilliams" collide.
 */
export function titleKey(title) {
	return normalizeText((title ?? "").replace(MATCHING.titleVersionNote, "")).replace(/ /g, "");
}

/** Same as {@link titleKey} for a LaTeX-encoded title. */
export function latexTitleKey(latexTitle) {
	return titleKey(latexToText(latexTitle));
}

/** Sørensen–Dice coefficient over character bigrams of the compact title keys. */
export function titleSimilarity(a, b) {
	const x = titleKey(a);
	const y = titleKey(b);
	if (!x || !y) return 0;
	if (x === y) return 1;
	if (x.length < 2 || y.length < 2) return 0;
	const counts = new Map();
	for (let i = 0; i < x.length - 1; i++) {
		const bigram = x.slice(i, i + 2);
		counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
	}
	let overlap = 0;
	for (let i = 0; i < y.length - 1; i++) {
		const bigram = y.slice(i, i + 2);
		const count = counts.get(bigram);
		if (count) {
			overlap++;
			counts.set(bigram, count - 1);
		}
	}
	return (2 * overlap) / (x.length + y.length - 2);
}

/** Whether one title extends the other (e.g. by a subtitle), sharing a long enough prefix. */
export function titleExtends(a, b, minSharedPrefix = MATCHING.minSharedPrefix) {
	const [x, y] = [titleKey(a), titleKey(b)].sort((p, q) => p.length - q.length);
	return x.length >= minSharedPrefix && y.startsWith(x);
}

/**
 * @typedef {object} PersonName
 * @property {string} firstName
 * @property {string} lastName
 */

/**
 * Splits a string on a separator that is not inside braces.
 * @param {string} text
 * @param {RegExp} separatorRe A sticky (`y`) regular expression.
 */
function splitTopLevel(text, separatorRe) {
	const parts = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === "{") depth++;
		else if (c === "}") depth--;
		else if (depth === 0) {
			separatorRe.lastIndex = i;
			const match = separatorRe.exec(text);
			if (match) {
				parts.push(text.slice(start, i));
				i += match[0].length - 1;
				start = i + 1;
			}
		}
	}
	parts.push(text.slice(start));
	return parts.map((p) => p.trim()).filter(Boolean);
}

/** Splits a BibTeX name list ("A and B and C"). */
export function splitBibtexNames(value) {
	if (!value) return [];
	return splitTopLevel(value.replace(/\s+/g, " "), /\s+and\s+/iy);
}

function isParticle(word) {
	return PARTICLES.has(word.toLowerCase()) && word[0] === word[0].toLowerCase();
}

/**
 * Parses one BibTeX name ("First von Last", "von Last, First", "Last, Jr, First")
 * into Zotero's two-field form. A fully braced name ("{IACR}") is a single-field name.
 * @returns {PersonName & {fieldMode?: 1}}
 */
export function parseBibtexName(raw) {
	const trimmed = raw.trim();
	if (/^\{[^{}]*\}$/.test(trimmed)) {
		return { firstName: "", lastName: latexToText(trimmed), fieldMode: 1 };
	}
	const commaParts = splitTopLevel(trimmed, /,/y);
	if (commaParts.length >= 2) {
		const [last, ...rest] = commaParts;
		const first = rest.length === 2 ? `${rest[1]}` : rest.join(" ");
		const suffix = rest.length === 2 ? `, ${rest[0]}` : "";
		return { firstName: latexToText(first), lastName: latexToText(last) + suffix };
	}
	const words = splitTopLevel(trimmed, /\s+/y);
	if (words.length === 1) return { firstName: "", lastName: latexToText(words[0]) };
	// The last name starts at the first lower-case particle, or is the last word.
	let lastStart = words.length - 1;
	for (let i = 1; i < words.length - 1; i++) {
		if (isParticle(words[i])) {
			lastStart = i;
			break;
		}
	}
	return {
		firstName: latexToText(words.slice(0, lastStart).join(" ")),
		lastName: latexToText(words.slice(lastStart).join(" ")),
	};
}

/** Parses a plain "First Last" display name (as used by dblp and ePrint). */
export function parseDisplayName(name) {
	// dblp disambiguates homonyms with a numeric suffix: "Wei Wang 0001".
	return parseBibtexName(name.replace(/\s+\d{4}$/, ""));
}

/** Key used to compare people across sources: normalized last name. */
export function lastNameKey(lastName) {
	const words = normalizeText(lastName).split(" ").filter((w) => !PARTICLES.has(w));
	return words.join("");
}

/**
 * Fraction of the smaller author list whose last names appear in the other list.
 * Returns null when either list is empty (nothing to compare).
 * @param {string[]} a Last names
 * @param {string[]} b Last names
 */
export function authorOverlap(a, b) {
	const x = new Set(a.map(lastNameKey).filter(Boolean));
	const y = new Set(b.map(lastNameKey).filter(Boolean));
	if (!x.size || !y.size) return null;
	let common = 0;
	for (const name of x) if (y.has(name)) common++;
	return common / Math.min(x.size, y.size);
}

/** Normalizes a DOI for comparison: lower case, without resolver prefix. */
export function normalizeDOI(doi) {
	if (!doi) return "";
	const match = doi.trim().match(/10\.\d{4,9}\/\S+/);
	return match ? match[0].toLowerCase().replace(/[.,;]+$/, "") : "";
}

/** Converts BibTeX page ranges ("70--87") to Zotero's style ("70-87"). */
export function normalizePages(pages) {
	return (pages ?? "").replace(/\s*[-–—]+\s*/g, "-").trim();
}
