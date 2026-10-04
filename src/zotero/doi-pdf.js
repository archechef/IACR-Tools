/**
 * The PDF of a paper that has no IACR ePrint version, fetched through its DOI
 * with Zotero's own "Find Full Text" (Zotero.Attachments.addAvailableFile):
 * the publisher's page (fetched from the user's machine, so campus or VPN
 * access applies), open-access copies found by Unpaywall, and any custom
 * resolvers. Papers with an ePrint version are left to the ePrint download.
 */
import { DOI_PDF } from "../config.js";
import { serialized } from "../core/concurrency.js";
import { result } from "./pipeline.js";

export class DoiPdfAction {
	#queue = serialized();
	#nextStart = 0;

	/**
	 * @param {object} deps
	 * @param {any} deps.Zotero
	 * @param {(context: import("./pipeline.js").ItemContext) => Promise<string | null>} deps.eprintIdOf
	 *   The item's ePrint id, stored or looked up.
	 * @param {{ setTimeout: Function }} deps.timers
	 * @param {() => number} [deps.now]
	 */
	constructor({ Zotero, eprintIdOf, timers, now = () => Date.now() }) {
		this.Zotero = Zotero;
		this.eprintIdOf = eprintIdOf;
		this.timers = timers;
		this.now = now;
		/** @type {import("./pipeline.js").Action} */
		this.action = Object.freeze({ id: "download-doi-pdf", run: (context) => this.#run(context) });
	}

	/** @param {import("./pipeline.js").ItemContext} context */
	async #run(context) {
		const { item } = context;
		const parent = item.item;
		if (item.hasPDF({ epub: true })) return result.unchanged("PDF already attached");
		const doi = item.doi;
		if (!doi) return result.skipped("no DOI");
		const eprintId = await this.eprintIdOf(context);
		if (eprintId) return result.skipped(`ePrint version ${eprintId}: its PDF comes from the ePrint download`);
		const attachment = await this.#fetch(parent);
		if (!attachment) return result.unchanged("no PDF found via the DOI");
		return result.changed(`${attachment.getField("title") || "PDF"} from ${hostOf(attachment.getField("url"))}`);
	}

	/**
	 * One fetch at a time, spaced out: most DOIs of a list point to the same
	 * few publishers, which throttle or show a CAPTCHA when hit in parallel.
	 */
	#fetch(item) {
		return this.#queue(async () => {
			const wait = this.#nextStart - this.now();
			if (wait > 0) await new Promise((resolve) => this.timers.setTimeout(resolve, wait));
			try {
				return await this.Zotero.Attachments.addAvailableFile(item, { methods: [...DOI_PDF.methods] });
			}
			finally {
				this.#nextStart = this.now() + DOI_PDF.requestSpacingMs;
			}
		});
	}
}

/** "link.springer.com" from a URL, or the URL itself. */
function hostOf(url) {
	try {
		return new URL(url).hostname || url;
	}
	catch {
		return url || "the DOI";
	}
}
