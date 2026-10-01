import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { BibtexParser, MacroTable } from "../src/core/bibtex.js";
import { latexToText } from "../src/core/latex.js";
import {
	authorOverlap, normalizeDOI, parseBibtexName, splitBibtexNames, titleKey, titleSimilarity,
} from "../src/core/text.js";
import { formatEprintId, parseEprintId } from "../src/core/eprint.js";
import { buildRecords, CryptoBibIndex } from "../src/core/cryptobib.js";
import { toZoteroData } from "../src/core/mapping.js";
import { bestMatch } from "../src/core/matching.js";
import { getExtraField, setExtraField } from "../src/core/extra.js";

const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

async function loadIndex() {
	const macros = new MacroTable().load(fixture("abbrev0.bib"));
	return new CryptoBibIndex(await buildRecords(fixture("crypto.bib"), macros));
}

test("BibTeX parser handles macros, concatenation and nested braces", () => {
	const macros = new MacroTable();
	const entries = BibtexParser.parseAll(`
		@string{conf = "Conf"}
		@string{conf08 = conf # "~2008"}
		@comment{ ignored @Misc{ nope, title = "x" } }
		@InProceedings{K:A08,
		  title = "A {B {C}} \\"{o} title",
		  booktitle = conf08,
		  month = apr # "~1--2,",
		  year = 2008,
		}`, { onString: (name, value) => macros.define(name, value) });
	assert.equal(entries.length, 1);
	const [entry] = entries;
	assert.equal(entry.key, "K:A08");
	assert.equal(entry.fields.title, 'A {B {C}} \\"{o} title');
	assert.equal(macros.resolve(entry.fields.booktitle), "Conf~2008");
	assert.equal(macros.resolve(entry.fields.month), "April~1--2,");
	assert.equal(entry.fields.year, "2008");
});

test("BibTeX parser skips malformed entries and continues", () => {
	const errors = [];
	const entries = BibtexParser.parseAll(`@Misc{broken, title = "unterminated }\n@Misc{ok, title = {fine}}`, {
		onError: (e) => errors.push(e),
	});
	assert.deepEqual(entries.map((e) => e.key), ["ok"]);
	assert.equal(errors.length, 1);
});

test("LaTeX is converted to Unicode and Zotero rich text", () => {
	assert.equal(latexToText("Izabach{\\`e}ne"), "Izabachène");
	assert.equal(latexToText("Kilin{\\c c}"), "Kilinç");
	assert.equal(latexToText("{\\textcommabelow{S}}tefan"), "Ștefan");
	assert.equal(latexToText("Gj{\\o}steen and {\\'\\i}"), "Gjøsteen and í");
	assert.equal(latexToText("Advances in Cryptology -- {EUROCRYPT}~2008"), "Advances in Cryptology – EUROCRYPT 2008");
	assert.equal(latexToText("A Novel Window {$\\tau$NAF} on Koblitz Curves"), "A Novel Window τNAF on Koblitz Curves");
	assert.equal(latexToText("over $\\mathbb{F}_p$", { rich: true }), "over 𝔽<sub>p</sub>");
	assert.equal(latexToText("\\emph{Proofs} of \\textsf{Glitter}", { rich: true }), "<i>Proofs</i> of Glitter");
	assert.equal(latexToText("Plug\\&Charge"), "Plug&Charge");
	// Complex math is kept verbatim rather than mangled.
	assert.equal(latexToText("in $\\frac{1}{2}$"), "in $\\frac{1}{2}$");
});

test("BibTeX names are split into first and last names", () => {
	const names = splitBibtexNames("Daniel J. Bernstein and Ludwig van Beethoven and {IACR} and Coron, Jean-S{\\'e}bastien");
	assert.deepEqual(names.map(parseBibtexName), [
		{ firstName: "Daniel J.", lastName: "Bernstein" },
		{ firstName: "Ludwig", lastName: "van Beethoven" },
		{ firstName: "", lastName: "IACR", fieldMode: 1 },
		{ firstName: "Jean-Sébastien", lastName: "Coron" },
	]);
});

test("titles and authors are compared robustly", () => {
	assert.equal(titleKey("Rabin–Williams Signatures."), titleKey("{Rabin}-{Williams} signatures"));
	assert.ok(titleSimilarity("Threshold RSA for Dynamic and Ad-Hoc Groups", "Threshold RSA for dynamic and ad hoc groups (full version)") > 0.8);
	assert.equal(authorOverlap(["Gjøsteen", "Müller"], ["Gjosteen", "Muller", "Silde"]), 1);
	assert.equal(authorOverlap([], ["X"]), null);
	assert.equal(normalizeDOI("https://doi.org/10.1007/978-3-540-78967-3_5."), "10.1007/978-3-540-78967-3_5");
});

test("ePrint ids are parsed from ids, URLs and reports", () => {
	assert.equal(parseEprintId("https://eprint.iacr.org/2008/45.pdf"), "2008/045");
	assert.equal(parseEprintId("Cryptology ePrint Archive, Report 2025/001"), "2025/001");
	assert.equal(parseEprintId("2019/1234"), "2019/1234");
	assert.equal(parseEprintId("10.1007/978-3-540-78967-3_5"), null);
	assert.equal(formatEprintId("2001", "7"), "2001/007");
});

test("CryptoBib index finds publications by DOI, exact and fuzzy title", async () => {
	const index = await loadIndex();
	const byDOI = index.findPublication({ doi: "10.1007/978-3-540-78967-3_6", title: "", authors: [] });
	assert.equal(byDOI.candidate.key, "EC:GHKR08");
	assert.equal(byDOI.method, "doi");

	const byTitle = index.findPublication({ title: "Proving tight security for Rabin–Williams signatures", authors: ["Bernstein"], year: 2008 });
	assert.equal(byTitle.candidate.key, "EC:Bernstein08");

	const fuzzy = index.findPublication({ title: "Verifiable decryption in the head.", authors: ["Gjøsteen", "Haines"], year: 2022 });
	assert.equal(fuzzy.candidate.key, "ACISP:GHMRS22");

	assert.equal(index.findPublication({ title: "Proving tight security for Rabin–Williams signatures", authors: ["Someone"], year: 2008 }), null);
	assert.equal(index.findPublication({ title: "Proving tight security for Rabin–Williams signatures", authors: ["Bernstein"], year: 2015 }), null);
});

test("CryptoBib index finds the ePrint version regardless of the year", async () => {
	const index = await loadIndex();
	const match = index.findEprint({ title: "Threshold RSA for Dynamic and Ad-Hoc Groups", authors: ["Gennaro", "Rabin"], year: 2010, doi: "10.1007/978-3-540-78967-3_6" });
	assert.equal(match.candidate.key, "EPRINT:GHKR08");
	assert.equal(toZoteroData(match.candidate).eprintId, "2008/045");
});

test("records map to Zotero data, including the derived conference name", async () => {
	const index = await loadIndex();
	const data = toZoteroData(index.getByKey("C:ZSELLR24"));
	const field = (name) => data.fields.find((f) => f.candidates[0] === name)?.value;
	assert.equal(data.itemType, "conferencePaper");
	assert.equal(data.citationKey, "C:ZSELLR24");
	assert.equal(field("publicationTitle"), "Advances in Cryptology – CRYPTO 2024, Part I");
	assert.equal(field("conferenceName"), "CRYPTO 2024");
	assert.equal(field("eventPlace"), "Santa Barbara, CA, USA");
	assert.equal(field("date"), "2024-08");
	assert.equal(field("pages"), "3-38");
	assert.deepEqual(data.creators.at(-1), { firstName: "Douglas", lastName: "Stebila", creatorType: "editor" });

	const journal = toZoteroData(index.getByKey("JC:LibYun20"));
	assert.equal(journal.itemType, "journalArticle");
	assert.equal(journal.fields.find((f) => f.candidates[0] === "issue").value, "4");
});

test("bestMatch prefers DOI matches and is strict with short titles", () => {
	const candidates = [
		{ title: "Something else entirely here", authors: ["Au"], doi: "10.1007/x" },
		{ title: "Short E-Cash", authors: ["Au", "Chow"] },
	];
	assert.equal(bestMatch({ title: "", authors: [], doi: "10.1007/X" }, candidates).candidate, candidates[0]);
	assert.equal(bestMatch({ title: "Short e-cash.", authors: ["Chow"] }, candidates).candidate, candidates[1]);
	assert.equal(bestMatch({ title: "Short e-cash", authors: [] }, candidates), null);
	assert.equal(bestMatch({ title: "Short cash", authors: ["Chow"] }, candidates), null);
});

test("a title extended by a subtitle matches when the authors agree", () => {
	const eprint = { title: "Correcting the Algebraic Immunity of the Hidden Weight Bit Function", authors: ["Gini", "Méaux"] };
	const published = "Correcting the Algebraic Immunity of the Hidden Weight Bit Function - Upper Bounds and Their Implications";
	assert.equal(bestMatch({ title: published, authors: ["Meaux"] }, [eprint], { yearTolerance: null })?.method, "fuzzy-title");
	assert.equal(bestMatch({ title: published, authors: ["Someone"] }, [eprint], { yearTolerance: null }), null);
	assert.equal(bestMatch({ title: published, authors: [] }, [eprint], { yearTolerance: null }), null);
});

test("version notes do not prevent title matches", () => {
	assert.equal(titleKey("Threshold RSA (Extended Abstract)"), titleKey("Threshold RSA"));
	assert.equal(titleKey("Threshold RSA: Full Version."), titleKey("Threshold RSA"));
	assert.equal(titleKey("Invited Talk: Threshold RSA"), titleKey("Invited Talk: Threshold RSA"));
});

test("an empty Extra line does not take the value of the next line", () => {
	const extra = "Citation Key:\nDOI: 10.1007/978-3-540-78967-3_5";
	assert.equal(getExtraField(extra, "Citation Key"), "");
	assert.equal(getExtraField(extra, "DOI"), "10.1007/978-3-540-78967-3_5");
	assert.equal(getExtraField("IACR ePrint: 2008/045\r\nDOI: 10.1/x", "IACR ePrint"), "2008/045");
	assert.equal(setExtraField(extra, "Citation Key", "EC:Bernstein08"), "Citation Key: EC:Bernstein08\nDOI: 10.1007/978-3-540-78967-3_5");
});

test("matching a large library stays fast", () => {
	const words = "secure efficient lattice based threshold signatures from learning with errors zero knowledge".split(" ");
	const library = Array.from({ length: 10_000 }, (_, i) => ({
		title: `${Array.from({ length: 8 }, (_, j) => words[(i * 7 + j * 3) % words.length]).join(" ")} ${i}`,
		authors: ["Smith", "Lee"],
		year: 2020,
	}));
	const wanted = library[4321];
	const start = performance.now();
	for (let k = 0; k < 50; k++) bestMatch({ title: `An unrelated paper ${k}`, authors: ["Nobody"], year: 2020 }, library);
	const found = bestMatch({ title: wanted.title.toUpperCase(), authors: ["Lee"], year: 2020 }, library);
	assert.equal(found?.candidate, wanted);
	// About 2.5 ms per lookup here; the old matcher needed ~160 ms.
	assert.ok((performance.now() - start) / 51 < 40, "lookup took too long");
});
