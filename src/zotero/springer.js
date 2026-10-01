/**
 * Springer publishes conference proceedings as books (e.g. LNCS), so its
 * translator and Crossref import their papers as book sections. This action
 * converts them to conference papers.
 */
import { SPRINGER } from "../config.js";
import { result } from "./pipeline.js";

/** @param {import("./item.js").ItemWrapper} item */
export function isSpringerChapter(item) {
	return SPRINGER.sourceItemTypes.includes(item.itemType)
		&& SPRINGER.doiPrefixes.some((prefix) => item.doi.startsWith(prefix));
}

/**
 * Decides whether a Springer chapter is a conference paper. CryptoBib is
 * authoritative when it knows the paper; otherwise the book series and title
 * are used as evidence.
 * @param {import("./item.js").ItemWrapper} item
 * @param {import("../core/matching.js").Match<import("../core/cryptobib.js").CryptoBibRecord> | null} match
 */
export function isProceedingsChapter(item, match) {
	if (match) return match.candidate.type === "inproceedings";
	const series = item.getField("series");
	return SPRINGER.proceedingsSeries.some((re) => re.test(series))
		|| SPRINGER.proceedingsTitle.test(item.getField("publicationTitle"));
}

/** @type {import("./pipeline.js").Action} */
export const convertSpringerAction = Object.freeze({
	id: "convert-springer",
	async run(context) {
		const { item } = context;
		if (!isSpringerChapter(item)) return result.skipped("not a Springer chapter");
		const match = await context.publicationMatch().catch(() => null);
		if (!isProceedingsChapter(item, match)) return result.unchanged("not a proceedings chapter");
		item.convertTo(SPRINGER.targetItemType);
		await item.save();
		return result.changed(SPRINGER.targetItemType);
	},
});
