/**
 * Downloads made in the user's browser: which link to open for a paper, and
 * which paper a downloaded file belongs to, judged by its file name (ACM names
 * its PDFs after the DOI, "3576915.3623096.pdf"; others use the title).
 */
import { BROWSER_DOWNLOAD, EPRINT } from "../config.js";
import { eprintPdfURL } from "./eprint.js";
import { eprintIdFromFileName } from "./pdf-text.js";
import { titleKey } from "./text.js";

/**
 * @typedef {object} WantedPaper
 * @property {string} doi  May be empty for a paper with an ePrint id.
 * @property {string} title
 * @property {string} [eprintId]  "YYYY/NNN"; its PDF is fetched from the ePrint archive.
 */

/** The link to open in the browser for a DOI. */
export function browserPdfURL(doi) {
	const known = BROWSER_DOWNLOAD.pdfURLs.find(({ prefix }) => doi.toLowerCase().startsWith(prefix));
	return known ? known.url(doi) : BROWSER_DOWNLOAD.landingURL(doi);
}

/** The link to open for a paper: its ePrint PDF if it has an ePrint id, else see {@link browserPdfURL}. */
export function paperLink(paper) {
	return paper.eprintId ? eprintPdfURL(paper.eprintId) : browserPdfURL(paper.doi);
}

/** Letters and digits only, lower case: "10.1145/3576915.3623096" → "10114535769153623096". */
const compact = (text) => (text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The paper a downloaded file is named after: its ePrint id, its DOI (or the
 * DOI's part after the "/"), or its title, possibly cut short. Browsers save
 * "eprint.iacr.org/2024/001.pdf" as "001.pdf", which names the paper if no other
 * open paper has that number. Null unless exactly one paper fits.
 * @template {WantedPaper} P
 * @param {string} fileName
 * @param {P[]} papers
 * @returns {P | null}
 */
export function paperForFileName(fileName, papers) {
	const name = fileName.replace(/\.pdf$/i, "");
	const nameKey = compact(name);
	const nameTitle = titleKey(name);
	const min = BROWSER_DOWNLOAD.minNameKeyLength;
	const fileId = eprintIdFromFileName(fileName);
	const bareNumber = EPRINT.bareNumberFilePattern.exec(fileName)?.[1];
	const fits = (paper) => {
		if (paper.eprintId) {
			if (fileId === paper.eprintId) return true;
			if (bareNumber && Number(bareNumber) === Number(paper.eprintId.split("/")[1])) return true;
		}
		const suffix = compact(paper.doi.slice(paper.doi.indexOf("/") + 1));
		if (suffix.length >= min && nameKey.includes(suffix)) return true;
		const title = titleKey(paper.title);
		if (title.length < min || nameTitle.length < min) return false;
		// Browsers and publishers shorten long titles in file names.
		return nameTitle.includes(title) || (nameTitle.length >= BROWSER_DOWNLOAD.minTitlePrefixLength && title.startsWith(nameTitle));
	};
	const matches = papers.filter(fits);
	return matches.length === 1 ? matches[0] : null;
}
