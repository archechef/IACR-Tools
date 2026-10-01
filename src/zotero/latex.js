/**
 * LaTeX for cryptographers who cite from CryptoBib's crypto.bib: a \cite
 * command for the selected papers, and a BibTeX file holding only the papers
 * that crypto.bib lacks (so that it can be used next to it without clashes).
 *
 * A paper CryptoBib knows is cited by its CryptoBib key. Any other paper is
 * cited by the key of the BibTeX export: Better BibTeX's pinned key when it is
 * installed, else the item's own citation key, else the key Zotero's BibTeX
 * export makes up.
 */
import { EPRINT, EXTRA, LATEX } from "../config.js";
import { BibtexParser } from "../core/bibtex.js";
import { storedEprintId } from "./eprint.js";
import { ItemWrapper } from "./item.js";

/**
 * @typedef {object} Classified
 * @property {Array<{ item: any, key: string }>} inCryptoBib
 * @property {any[]} others  Regular items CryptoBib does not have.
 */

export class LatexSupport {
	/**
	 * @param {object} deps
	 * @param {any} deps.Zotero
	 * @param {import("./cryptobib-store.js").CryptoBibStore} deps.store
	 * @param {() => string} deps.eprintKey
	 */
	constructor({ Zotero, store, eprintKey }) {
		this.Zotero = Zotero;
		this.store = store;
		this.eprintKey = eprintKey;
	}

	/**
	 * The CryptoBib key of an item, if CryptoBib has the paper: its stored key,
	 * or the entry found by ePrint id (preprints) or by title and authors.
	 * @param {import("../core/cryptobib.js").CryptoBibIndex} index
	 * @returns {string | null}
	 */
	cryptoBibKey(index, item) {
		const wrapper = new ItemWrapper(item, this.Zotero);
		const own = wrapper.getField("citationKey") || wrapper.getExtra(EXTRA.citationKey);
		if (own && index.getByKey(own)) return own;
		if (wrapper.itemType === EPRINT.itemType) {
			const id = storedEprintId(wrapper, this.eprintKey());
			const byId = id && index.getEprint(id);
			return (byId || index.findEprint(wrapper.reference)?.candidate)?.key ?? null;
		}
		return index.findPublication(wrapper.reference)?.candidate.key ?? null;
	}

	/**
	 * Splits the regular items (in order, without duplicates) into those that
	 * CryptoBib has and the rest.
	 * @returns {Promise<Classified>}
	 */
	async classify(items) {
		const index = await this.store.getIndex();
		/** @type {Classified} */
		const classified = { inCryptoBib: [], others: [] };
		for (const item of new Set(items)) {
			if (!item?.isRegularItem?.() || item.deleted) continue;
			const key = this.cryptoBibKey(index, item);
			if (key) classified.inCryptoBib.push({ item, key });
			else classified.others.push(item);
		}
		return classified;
	}

	/** The export translator: Better BibTeX when it is installed. */
	get translatorID() {
		return this.Zotero.BetterBibTeX ? LATEX.translators.betterBibTeX : LATEX.translators.bibTeX;
	}

	/**
	 * The items as BibTeX, through Zotero's export translator.
	 * @returns {Promise<string>}
	 */
	exportBibTeX(items) {
		const translation = new this.Zotero.Translate.Export();
		translation.setItems(items);
		translation.setTranslator(this.translatorID);
		return new Promise((resolve, reject) => {
			translation.setHandler("done", (obj, worked) => (worked ? resolve(obj.string ?? "") : reject(new Error("The BibTeX export failed"))));
			Promise.resolve(translation.translate()).catch(reject);
		});
	}

	/**
	 * The key under which the BibTeX export writes a paper CryptoBib lacks.
	 * @returns {Promise<string | null>}
	 */
	async exportKey(item) {
		const pinned = this.Zotero.BetterBibTeX?.KeyManager?.get?.(item.id)?.citationKey;
		if (pinned) return pinned;
		const wrapper = new ItemWrapper(item, this.Zotero);
		const own = wrapper.getField("citationKey") || wrapper.getExtra(EXTRA.citationKey);
		if (own) return own;
		const [entry] = BibtexParser.parseAll(await this.exportBibTeX([item]));
		return entry?.key || null;
	}

	/**
	 * A \cite command for the items, CryptoBib keys first-hand.
	 * @returns {Promise<{ text: string, keys: number, notInCryptoBib: number, withoutKey: number }>}
	 */
	async citeCommand(items) {
		const { inCryptoBib, others } = await this.classify(items);
		const keyOf = new Map(inCryptoBib.map(({ item, key }) => [item, key]));
		let withoutKey = 0;
		for (const item of others) {
			const key = await this.exportKey(item);
			if (key) keyOf.set(item, key);
			else withoutKey++;
		}
		const keys = [...new Set([...new Set(items)].map((item) => keyOf.get(item)).filter(Boolean))];
		return {
			text: keys.length ? `\\${LATEX.citeCommand}{${keys.join(",")}}` : "",
			keys: keys.length,
			notInCryptoBib: others.length,
			withoutKey,
		};
	}

	/**
	 * A BibTeX file of the items that CryptoBib lacks, with a header saying how
	 * to use it next to crypto.bib.
	 * @param {any[]} items
	 * @param {{ header: string }} options  Comment lines (without "%").
	 * @returns {Promise<{ text: string, exported: number, inCryptoBib: number }>}
	 */
	async bibliographyNotInCryptoBib(items, { header }) {
		const { inCryptoBib, others } = await this.classify(items);
		if (!others.length) return { text: "", exported: 0, inCryptoBib: inCryptoBib.length };
		const comment = header.split("\n").map((line) => `% ${line}`.trimEnd()).join("\n");
		const bibtex = await this.exportBibTeX(others);
		return { text: `${comment}\n\n${bibtex.trim()}\n`, exported: others.length, inCryptoBib: inCryptoBib.length };
	}
}
