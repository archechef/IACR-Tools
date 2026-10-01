/**
 * A small, fast BibTeX parser that understands everything CryptoBib uses:
 * `@string` macros, `#` concatenation, quoted and braced values, bare numbers
 * and macro references. Field values are kept *unresolved* (see {@link BibValue})
 * so that the caller can resolve them against any abbreviation file and still
 * know which macro a value came from.
 */

/**
 * A literal string, or a list of literal strings and macro references.
 * Plain strings are used whenever a value has no macro, which keeps memory low.
 * @typedef {string | Array<string | {macro: string}>} BibValue
 */

/**
 * @typedef {object} BibEntry
 * @property {string} type    Lower-cased entry type, e.g. "inproceedings".
 * @property {string} key     Citation key, e.g. "EC:Bernstein08".
 * @property {Record<string, BibValue>} fields Lower-cased field name → value.
 */

const SKIPPED_TYPES = new Set(["comment", "preamble"]);
const WHITESPACE = /\s/;
const IDENT_TERMINATORS = new Set([" ", "\t", "\n", "\r", ",", "#", "}", ")", "=", '"', "{"]);

export class BibtexSyntaxError extends Error {
	constructor(message, offset) {
		super(`${message} at offset ${offset}`);
		this.name = "BibtexSyntaxError";
		this.offset = offset;
	}
}

/**
 * Iterates over a BibTeX document. `@string` definitions are reported through
 * `onString`; regular entries are yielded. Malformed entries are skipped.
 */
export class BibtexParser {
	/**
	 * @param {string} text
	 * @param {object} [options]
	 * @param {(name: string, value: BibValue) => void} [options.onString]
	 * @param {(error: Error) => void} [options.onError]
	 */
	constructor(text, { onString = () => {}, onError = () => {} } = {}) {
		this.text = text;
		this.pos = 0;
		this.onString = onString;
		this.onError = onError;
	}

	/** @returns {Generator<BibEntry>} */
	*entries() {
		const { text } = this;
		while (true) {
			const at = text.indexOf("@", this.pos);
			if (at < 0) return;
			this.pos = at + 1;
			try {
				const entry = this.#parseAfterAt();
				if (entry) yield entry;
			}
			catch (e) {
				if (!(e instanceof BibtexSyntaxError)) throw e;
				this.onError(e);
				this.pos = at + 1;
			}
		}
	}

	/** Convenience: parse everything into an array. */
	static parseAll(text, options) {
		return [...new BibtexParser(text, options).entries()];
	}

	#parseAfterAt() {
		const type = this.#readIdentifier().toLowerCase();
		if (!type) return null;
		this.#skipWhitespace();
		const open = this.text[this.pos];
		if (open !== "{" && open !== "(") return null;
		const close = open === "{" ? "}" : ")";

		if (SKIPPED_TYPES.has(type)) {
			this.#skipBalanced();
			return null;
		}
		this.pos++;

		if (type === "string") {
			this.#skipWhitespace();
			const name = this.#readIdentifier().toLowerCase();
			this.#expect("=");
			const value = this.#readValue();
			this.#skipWhitespace();
			this.#expect(close);
			this.onString(name, value);
			return null;
		}

		const key = this.#readKey();
		/** @type {Record<string, BibValue>} */
		const fields = {};
		while (true) {
			this.#skipWhitespaceAndCommas();
			if (this.text[this.pos] === close) {
				this.pos++;
				break;
			}
			if (this.pos >= this.text.length) {
				throw new BibtexSyntaxError("Unterminated entry", this.pos);
			}
			const name = this.#readIdentifier().toLowerCase();
			if (!name) throw new BibtexSyntaxError("Expected field name", this.pos);
			this.#expect("=");
			fields[name] = this.#readValue();
		}
		return { type, key, fields };
	}

	#readKey() {
		const { text } = this;
		const start = this.pos;
		let end = start;
		while (end < text.length && text[end] !== "," && text[end] !== "}" && text[end] !== ")") end++;
		if (text[end] !== ",") throw new BibtexSyntaxError("Expected ',' after key", end);
		this.pos = end + 1;
		return text.slice(start, end).trim();
	}

	/** @returns {BibValue} */
	#readValue() {
		/** @type {Array<string | {macro: string}>} */
		const pieces = [];
		while (true) {
			this.#skipWhitespace();
			const c = this.text[this.pos];
			if (c === '"') pieces.push(this.#readDelimited('"'));
			else if (c === "{") pieces.push(this.#readDelimited("}"));
			else {
				const word = this.#readIdentifier();
				if (!word) throw new BibtexSyntaxError("Expected value", this.pos);
				pieces.push(/^\d+$/.test(word) ? word : { macro: word.toLowerCase() });
			}
			this.#skipWhitespace();
			if (this.text[this.pos] !== "#") break;
			this.pos++;
		}
		return pieces.length === 1 && typeof pieces[0] === "string" ? pieces[0] : pieces;
	}

	/** Reads a "…" or {…} value, honouring nested braces; returns the inner text. */
	#readDelimited(terminator) {
		const { text } = this;
		const start = ++this.pos;
		let depth = 0;
		for (let i = start; i < text.length; i++) {
			const c = text[i];
			if (c === "\\") {
				i++;
				continue;
			}
			if (c === "{") depth++;
			else if (c === "}") {
				if (depth === 0 && terminator === "}") {
					this.pos = i + 1;
					return text.slice(start, i);
				}
				depth--;
			}
			else if (c === terminator && depth === 0) {
				this.pos = i + 1;
				return text.slice(start, i);
			}
		}
		throw new BibtexSyntaxError("Unterminated value", start);
	}

	#skipBalanced() {
		const { text } = this;
		const open = text[this.pos];
		const close = open === "{" ? "}" : ")";
		let depth = 0;
		for (let i = this.pos; i < text.length; i++) {
			if (text[i] === open) depth++;
			else if (text[i] === close && --depth === 0) {
				this.pos = i + 1;
				return;
			}
		}
		this.pos = text.length;
	}

	#readIdentifier() {
		const { text } = this;
		this.#skipWhitespace();
		const start = this.pos;
		while (this.pos < text.length && !IDENT_TERMINATORS.has(text[this.pos])) this.pos++;
		return text.slice(start, this.pos);
	}

	#expect(char) {
		this.#skipWhitespace();
		if (this.text[this.pos] !== char) {
			throw new BibtexSyntaxError(`Expected '${char}'`, this.pos);
		}
		this.pos++;
	}

	#skipWhitespace() {
		const { text } = this;
		while (this.pos < text.length && WHITESPACE.test(text[this.pos])) this.pos++;
	}

	#skipWhitespaceAndCommas() {
		const { text } = this;
		while (this.pos < text.length && (text[this.pos] === "," || WHITESPACE.test(text[this.pos]))) this.pos++;
	}
}

/** The month macros that BibTeX predefines. */
export const BUILTIN_MACROS = Object.freeze({
	jan: "January", feb: "February", mar: "March", apr: "April", may: "May", jun: "June",
	jul: "July", aug: "August", sep: "September", oct: "October", nov: "November", dec: "December",
});

/**
 * A table of `@string` macros that resolves values lazily and memoizes results.
 */
export class MacroTable {
	/** @param {Record<string, string>} [builtins] */
	constructor(builtins = BUILTIN_MACROS) {
		/** @type {Map<string, BibValue>} */
		this.raw = new Map(Object.entries(builtins));
		/** @type {Map<string, string>} */
		this.cache = new Map();
	}

	/**
	 * @param {string} name
	 * @param {BibValue} value
	 */
	define(name, value) {
		this.raw.set(name.toLowerCase(), value);
		this.cache.clear();
	}

	has(name) {
		return this.raw.has(name.toLowerCase());
	}

	/**
	 * Resolves a macro by name; unknown macros resolve to their own name, like BibTeX does (with a warning).
	 * @returns {string}
	 */
	get(name, seen = new Set()) {
		name = name.toLowerCase();
		const cached = this.cache.get(name);
		if (cached !== undefined) return cached;
		if (!this.raw.has(name) || seen.has(name)) return name;
		seen.add(name);
		const value = this.resolve(this.raw.get(name), seen);
		this.cache.set(name, value);
		return value;
	}

	/**
	 * @param {BibValue | undefined} value
	 * @returns {string | undefined}
	 */
	resolve(value, seen = new Set()) {
		if (value === undefined) return undefined;
		if (!Array.isArray(value)) return value;
		return value.map((piece) => (typeof piece === "string" ? piece : this.get(piece.macro, new Set(seen)))).join("");
	}

	/** Parses a BibTeX file containing `@string` definitions into this table. */
	load(text) {
		const parser = new BibtexParser(text, { onString: (name, value) => this.define(name, value) });
		for (const _ of parser.entries()) { /* only @string definitions matter */ }
		return this;
	}
}

/** Returns the macro name if a value is exactly one macro reference. */
export function singleMacroName(value) {
	return Array.isArray(value) && value.length === 1 && typeof value[0] === "object" ? value[0].macro : null;
}
