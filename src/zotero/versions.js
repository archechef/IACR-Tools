/**
 * The ePrint and the published version of a paper: preprints whose
 * publication CryptoBib knows become the published paper, and the two
 * versions are linked as related items when both are in the library.
 */
import { EPRINT } from "../config.js";
import { parseEprintId } from "../core/eprint.js";
import { toZoteroData } from "../core/mapping.js";
import { applyZoteroData } from "./cryptobib-sync.js";
import { storedEprintId } from "./eprint.js";
import { result } from "./pipeline.js";

/** Quoted title of an item, for result details. */
const titleOf = (item) => `“${item.getDisplayTitle()}”`;

/**
 * @param {import("./prefs.js").Prefs} prefs
 * @returns {{ upgrade: import("./pipeline.js").Action, link: import("./pipeline.js").Action }}
 */
export function createVersionActions(prefs) {
	/** Links an item with the other version of its paper, if the library has it. */
	const link = Object.freeze({
		id: "link-versions",
		async run(context) {
			const { item } = context;
			const other = (await context.library()).findOtherVersion(item.item);
			if (!other) return result.unchanged("no other version in the library");
			const added = await item.relateTo(other);
			await item.save();
			return added ? result.changed(`linked with ${titleOf(other)}`) : result.unchanged(`linked with ${titleOf(other)}`);
		},
	});

	/**
	 * Turns an ePrint preprint into its published version when CryptoBib knows
	 * it: the published metadata replaces the preprint's, the ePrint id stays
	 * in Extra and the attachments (the ePrint PDF) are kept. When the library
	 * already holds the published version, the two are linked instead.
	 */
	const upgrade = Object.freeze({
		id: "upgrade-preprint",
		async run(context) {
			const { item } = context;
			if (item.itemType !== EPRINT.itemType) return result.skipped("not a preprint");
			const index = await context.store.getIndex();
			// A preprint may predate its publication by years: the year is not compared.
			const match = index.findPublication({ ...item.reference, doi: undefined }, { yearTolerance: null });
			if (!match) return result.unchanged("not published yet, according to CryptoBib");

			const published = (await context.library()).findOtherVersion(item.item);
			if (published) {
				const added = await item.relateTo(published);
				await item.save();
				const detail = `the published version is already in the library: ${titleOf(published)}`;
				return added ? result.changed(`${detail} (linked)`) : result.unchanged(detail);
			}

			const key = prefs.eprintKey();
			const eprintId = storedEprintId(item, key);
			if (eprintId) item.setExtra(key, eprintId);
			// Fields that describe the preprint only: Zotero would carry the archive's
			// name over as the publisher, and the ePrint page is not the paper's URL.
			item.clearField("repository");
			if (parseEprintId(item.getField("url"))) item.clearField("url");
			const data = toZoteroData(match.candidate);
			item.convertTo(data.itemType);
			applyZoteroData(item, data, { overwrite: true, replaceCreators: true });
			await item.save();
			return result.changed(`${match.candidate.conference ?? match.candidate.key}${eprintId ? ` (ePrint ${eprintId} kept)` : ""}`);
		},
	});

	return { upgrade, link };
}
