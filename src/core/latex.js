/**
 * Conversion of the LaTeX found in BibTeX fields into Unicode text. Zotero
 * titles support a small subset of HTML (<i>, <b>, <sub>, <sup>, small caps),
 * which is used when `rich` output is requested.
 */

const COMBINING_ACCENTS = Object.freeze({
	"'": "\u0301", "`": "\u0300", "^": "\u0302", '"': "\u0308", "~": "\u0303",
	"=": "\u0304", ".": "\u0307", u: "\u0306", v: "\u030C", H: "\u030B",
	c: "\u0327", k: "\u0328", r: "\u030A", b: "\u0331", d: "\u0323",
	textcommabelow: "\u0326",
});

const SYMBOL_COMMANDS = Object.freeze({
	ss: "ß", o: "ø", O: "Ø", l: "ł", L: "Ł", aa: "å", AA: "Å", ae: "æ", AE: "Æ",
	oe: "œ", OE: "Œ", i: "ı", j: "ȷ", dh: "ð", DH: "Ð", th: "þ", TH: "Þ",
	textendash: "–", textemdash: "—", texttimes: "×", textregistered: "®",
	texttrademark: "™", textquoteright: "’", textquoteleft: "‘", ldots: "…",
	dots: "…", dj: "đ", DJ: "Đ", textperthousand: "‰", textasciiacute: "´",
	textasciibreve: "˘", textasciitilde: "~", relax: "", "/": "",
});

const ESCAPED_CHARS = Object.freeze({
	"&": "&", "#": "#", "_": "_", "%": "%", "$": "$", "{": "{", "}": "}",
	",": " ", "!": "", ";": " ", ":": " ", " ": " ", "(": "(", ")": ")", "-": "",
});

const MATH_SYMBOLS = Object.freeze({
	alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε",
	zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
	lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ",
	sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ",
	chi: "χ", psi: "ψ", omega: "ω", ell: "ℓ",
	Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ",
	Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
	varGamma: "Γ", varDelta: "Δ", varTheta: "Θ", varLambda: "Λ", varXi: "Ξ",
	varPi: "Π", varSigma: "Σ", varUpsilon: "Υ", varPhi: "Φ", varPsi: "Ψ", varOmega: "Ω",
	times: "×", cdot: "·", pm: "±", leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠",
	ne: "≠", approx: "≈", equiv: "≡", infty: "∞", star: "⋆", circ: "∘",
	oplus: "⊕", otimes: "⊗", rightarrow: "→", to: "→", leftarrow: "←",
	langle: "⟨", rangle: "⟩", log: "log", ell_: "ℓ", sqrt: "√", in: "∈",
	cap: "∩", cup: "∪", subset: "⊂", subseteq: "⊆", ast: "∗", bot: "⊥", top: "⊤",
	dots: "…", ldots: "…", cdots: "⋯", mid: "|", vert: "|", scriptstyle: "", displaystyle: "",
});

/** Math accents, rendered with combining characters. */
const MATH_ACCENTS = Object.freeze({ tilde: "\u0303", hat: "\u0302", bar: "\u0304", vec: "\u20D7", dot: "\u0307" });

const BLACKBOARD = Object.freeze({
	C: "ℂ", F: "𝔽", G: "𝔾", H: "ℍ", K: "𝕂", N: "ℕ", P: "ℙ", Q: "ℚ", R: "ℝ", Z: "ℤ",
});

/** Formatting commands: [HTML open, HTML close] in rich mode; content only otherwise. */
const FORMATTING_COMMANDS = Object.freeze({
	emph: ["<i>", "</i>"],
	textit: ["<i>", "</i>"],
	textsl: ["<i>", "</i>"],
	textbf: ["<b>", "</b>"],
	textsc: ['<span style="font-variant:small-caps;">', "</span>"],
	textsuperscript: ["<sup>", "</sup>"],
	textsubscript: ["<sub>", "</sub>"],
	textsf: ["", ""],
	texttt: ["", ""],
	textrm: ["", ""],
	textup: ["", ""],
	textnormal: ["", ""],
	mbox: ["", ""],
	text: ["", ""],
	url: ["", ""],
	nolinkurl: ["", ""],
});

const DROPPED_COMMANDS = new Set(["cite", "label", "footnote", "thanks"]);

/** A braced group `{…}` (balanced one level of nesting) or a single token. */
const ARG = String.raw`(?:\{((?:[^{}]|\{[^{}]*\})*)\}|(\\?[A-Za-z]))`;
const SYMBOL_ACCENT_RE = new RegExp(String.raw`\\(['\`^"~=.])\s*${ARG}`, "g");
const LETTER_ACCENT_RE = new RegExp(String.raw`\\([uvHckrbd]|textcommabelow)(?:\s*\{((?:[^{}]|\{[^{}]*\})*)\}|\s+(\\?[A-Za-z]))`, "g");
const SYMBOL_COMMAND_RE = new RegExp(String.raw`\\(${Object.keys(SYMBOL_COMMANDS).map(escapeRegExp).sort((a, b) => b.length - a.length).join("|")})(?![A-Za-z])\s?`, "g");
const FORMATTING_RE = new RegExp(String.raw`\\(${Object.keys(FORMATTING_COMMANDS).join("|")})\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}`, "g");
const DROPPED_RE = new RegExp(String.raw`\\(${[...DROPPED_COMMANDS].join("|")})\s*(\[[^\]]*\])?\{[^{}]*\}`, "g");
const ESCAPED_RE = /\\([&#_%${},!;: ()\-])/g;
const MATH_RE = /(?<!\\)\$((?:\\\$|[^$])+?)(?<!\\)\$/g;

function escapeRegExp(s) {
	return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function applyAccent(accent, letter) {
	const base = SYMBOL_COMMANDS[letter.replace(/^\\/, "")] ?? letter;
	// Accents on dotless i/j are written \'{\i}; the accent replaces the dot.
	const plain = base === "ı" ? "i" : base === "ȷ" ? "j" : base;
	return (plain + COMBINING_ACCENTS[accent]).normalize("NFC");
}

/**
 * Converts math content to plain text when it only uses simple symbols;
 * returns null when it is too complex to render faithfully.
 */
function mathToText(math, rich) {
	let out = math
		.replace(/\\mathbb\s*\{+\s*([A-Z])\s*\}+/g, (m, l) => BLACKBOARD[l] ?? l)
		.replace(/\\(?:mathsf|mathrm|mathit|mathbf|mathcal|mathtt|text|textsf|textrm|texttt|mbox|operatorname)\s*\{([^{}]*)\}/g, "$1")
		.replace(/\\(tilde|hat|bar|vec|dot)\s*(?:\{\s*([A-Za-z])\s*\}|\s([A-Za-z]))/g,
			(m, accent, braced, single) => ((braced ?? single) + MATH_ACCENTS[accent]).normalize("NFC"))
		.replace(/\\([A-Za-z]+)(?![A-Za-z]) ?/g, (m, name) => MATH_SYMBOLS[name] ?? m)
		.replace(/\\([{}_$&%#,;!: ])/g, (m, c) => ESCAPED_CHARS[c] ?? c);
	const script = (tag) => (m, braced, single) => {
		const content = braced ?? single;
		return rich ? `<${tag}>${content}</${tag}>` : content;
	};
	out = out
		.replace(/_\s*(?:\{([^{}]*)\}|([^\s{}]))/g, script("sub"))
		.replace(/\^\s*(?:\{([^{}]*)\}|([^\s{}]))/g, script("sup"));
	if (/[\\^_]/.test(out)) return null;
	return out.replace(/[{}]/g, "");
}

/**
 * @param {string | undefined} latex
 * @param {object} [options]
 * @param {boolean} [options.rich=false] Emit the HTML subset Zotero supports in titles.
 * @returns {string}
 */
export function latexToText(latex, { rich = false } = {}) {
	if (!latex) return "";
	const mathSegments = [];
	let s = latex.replace(MATH_RE, (m, math) => {
		const text = mathToText(math, rich);
		mathSegments.push(text ?? m);
		return `\u0000${mathSegments.length - 1}\u0000`;
	});

	s = s
		.replace(DROPPED_RE, "")
		.replace(SYMBOL_ACCENT_RE, (m, accent, braced, single) => applyAccent(accent, (braced ?? single).trim()))
		.replace(LETTER_ACCENT_RE, (m, accent, braced, single) => applyAccent(accent, (braced ?? single).trim()))
		.replace(SYMBOL_COMMAND_RE, (m, name) => SYMBOL_COMMANDS[name]);

	// Formatting commands may nest; apply until stable.
	for (let previous; previous !== s;) {
		previous = s;
		s = s.replace(FORMATTING_RE, (m, name, content) => {
			const [open, close] = rich ? FORMATTING_COMMANDS[name] : ["", ""];
			return open + content + close;
		});
	}

	s = s
		.replace(ESCAPED_RE, (m, c) => ESCAPED_CHARS[c])
		.replace(/\\\\/g, " ")
		.replace(/---/g, "—")
		.replace(/--/g, "–")
		.replace(/``|''/g, '"')
		.replace(/~/g, " ")
		.replace(/[{}]/g, "")
		.replace(/\u0000(\d+)\u0000/g, (m, i) => mathSegments[Number(i)])
		.replace(/\s+/g, " ")
		.trim();
	return s;
}
