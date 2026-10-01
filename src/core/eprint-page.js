/**
 * Metadata of an IACR ePrint paper page, read from its Highwire / OpenGraph
 * meta tags (citation_title, citation_author, …). This is how a paper that
 * CryptoBib does not know yet becomes a Zotero item.
 */
import { EPRINT } from "../config.js";
import { parseDisplayName } from "./text.js";

/**
 * @typedef {object} EprintPaper
 * @property {string} id
 * @property {string} title
 * @property {Array<{ firstName: string, lastName: string, creatorType: "author" }>} creators
 * @property {string} [date]      ISO date or year.
 * @property {string} [abstract]
 * @property {string} [repository]
 * @property {string[]} tags
 * @property {string} url
 */

/**
 * Values of the meta tags with any of the given names, in document order.
 * @param {Document | { querySelectorAll: (selector: string) => Iterable<any> }} doc
 * @returns {Map<string, string[]>} lower-case tag name → values
 */
export function metaTagValues(doc) {
	/** @type {Map<string, string[]>} */
	const values = new Map();
	for (const element of doc.querySelectorAll("meta")) {
		const name = (element.getAttribute("name") ?? element.getAttribute("property") ?? "").toLowerCase();
		const content = element.getAttribute("content")?.trim();
		if (!name || !content) continue;
		const list = values.get(name) ?? [];
		list.push(content);
		values.set(name, list);
	}
	return values;
}

/**
 * Builds the paper from an ePrint page. Returns null when the page carries no
 * title (e.g. an error page or a withdrawn paper).
 * @param {string} id  ePrint id the page was fetched for.
 * @param {Document | { querySelectorAll: (selector: string) => Iterable<any> }} doc
 * @returns {EprintPaper | null}
 */
export function eprintPaperFromPage(id, doc) {
	const meta = metaTagValues(doc);
	const { metaTags } = EPRINT;
	const all = (names) => names.flatMap((name) => meta.get(name) ?? []);
	const first = (names) => all(names)[0];

	const title = first(metaTags.title);
	if (!title) return null;
	return {
		id,
		title,
		creators: all(metaTags.author).map((name) => ({ ...parseDisplayName(name), creatorType: "author" })),
		date: normalizeDate(first(metaTags.date)),
		abstract: first(metaTags.abstract),
		repository: first(metaTags.repository) ?? EPRINT.repositoryName,
		tags: [...new Set(all(metaTags.keywords))],
		url: EPRINT.pageURL(id),
	};
}

/**
 * When the paper was last revised (its article:modified_time), as an ISO
 * string; null if the page does not say.
 * @param {Document | { querySelectorAll: (selector: string) => Iterable<any> }} doc
 * @returns {string | null}
 */
export function eprintRevisionTime(doc) {
	const meta = metaTagValues(doc);
	const value = EPRINT.metaTags.modified.map((name) => meta.get(name)?.[0]).find(Boolean);
	return value && !Number.isNaN(Date.parse(value)) ? value : null;
}

/** "2024-08-03T14:51:25+00:00" → "2024-08-03"; a bare year stays a year. */
function normalizeDate(value) {
	if (!value) return undefined;
	const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(value.trim());
	return match ? match.slice(1).filter(Boolean).join("-") : undefined;
}
