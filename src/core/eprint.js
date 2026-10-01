/**
 * Helpers for IACR ePrint identifiers ("YYYY/NNN").
 */
import { EPRINT } from "../config.js";

/**
 * Extracts a canonical ePrint id from an id, a URL or a "Report YYYY/NNN" string.
 * @param {string | undefined} text
 * @returns {string | null} e.g. "2008/012"
 */
export function parseEprintId(text) {
	if (!text) return null;
	const match = EPRINT.idPattern.exec(text.trim());
	if (!match) return null;
	return formatEprintId(match[1], match[2]);
}

/** Formats an ePrint id with the archive's zero padding ("2008/12" → "2008/012"). */
export function formatEprintId(year, number) {
	return `${year}/${String(Number(number)).padStart(EPRINT.numberPadding, "0")}`;
}

export function eprintPageURL(id) {
	return EPRINT.pageURL(id);
}

export function eprintPdfURL(id) {
	return EPRINT.pdfURL(id);
}
