/**
 * Preprints and their published versions, revised ePrint PDFs, and LaTeX
 * (\cite keys, BibTeX of the papers CryptoBib lacks).
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CRYPTOBIB, LATEX } from "../src/config.js";
import { CryptoBibStore } from "../src/zotero/cryptobib-store.js";
import { EprintActions } from "../src/zotero/eprint.js";
import { cryptoBibSource, EprintFinder } from "../src/zotero/eprint-sources.js";
import { LatexSupport } from "../src/zotero/latex.js";
import { LibraryIndex } from "../src/zotero/library-index.js";
import { Pipeline } from "../src/zotero/pipeline.js";
import { Prefs } from "../src/zotero/prefs.js";
import { createVersionActions } from "../src/zotero/versions.js";
import { createFakeZotero } from "./fake-zotero.js";

const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

/** An ePrint page whose last revision is `modified`. */
const eprintPage = (modified) => ({
	querySelectorAll: () => [{ getAttribute: (name) => ({ property: "article:modified_time", content: modified })[name] ?? null }],
});

let env;

function setup({ pages = {}, download } = {}) {
	const Zotero = createFakeZotero({ download });
	const prefs = new Prefs({ Zotero, Services: null });
	const dataDirectory = mkdtempSync(join(tmpdir(), "iacr-versions-"));
	const log = (msg) => Zotero.logs.push(msg);
	const files = {
		join,
		exists: (path) => access(path).then(() => true, () => false),
		readText: (path) => readFile(path, "utf8"),
		writeText: (path, text) => writeFile(path, text),
		makeDirectory: (path) => mkdir(path, { recursive: true }).then(() => {}),
	};
	const http = {
		requests: [],
		async getText(url) {
			return url.endsWith(CRYPTOBIB.mainFile) ? fixture("crypto.bib") : fixture("abbrev0.bib");
		},
		async getDocument(url) {
			http.requests.push(url);
			const key = Object.keys(pages).find((k) => url.endsWith(k));
			if (!key) throw new Error(`404 ${url}`);
			return pages[key];
		},
	};
	const store = new CryptoBibStore({ http, files, prefs, dataDirectory, timers: { setTimeout: () => 0, clearTimeout: () => {} }, log });
	const eprintKey = "IACR ePrint";
	const pipeline = new Pipeline({
		Zotero, store, log,
		loadLibrary: (libraryID) => new LibraryIndex({ Zotero, files, eprintKey }).load(libraryID, { files: false }),
	});
	const finder = new EprintFinder(() => [cryptoBibSource(store)], log);
	const md5 = async (path) => Zotero.files.get(path) ?? false;
	const eprint = new EprintActions({ Zotero, prefs, finder, http, md5 });
	const versions = createVersionActions(prefs);
	const latex = new LatexSupport({ Zotero, store, eprintKey: () => eprintKey });
	const run = async (item, action) => (await pipeline.run([item], [action]))[0].results[0];
	return { Zotero, prefs, store, dataDirectory, http, pipeline, eprint, versions, latex, run };
}

beforeEach(() => {
	env = setup();
});

afterEach(() => {
	env.store.dispose();
	rmSync(env.dataDirectory, { recursive: true, force: true });
});

/** The ePrint preprint of EC:GHKR08, as saved from eprint.iacr.org (with its PDF). */
function ghkrPreprint(Zotero) {
	const item = Zotero.addItem("preprint", {
		fields: {
			title: "Threshold RSA for Dynamic and Ad-Hoc Groups",
			repository: "Cryptology ePrint Archive",
			archiveID: "2008/045",
			url: "https://eprint.iacr.org/2008/045",
			date: "2008",
			abstractNote: "We consider the use of threshold signatures in ad-hoc and dynamic groups.",
		},
		creators: ["Gennaro", "Halevi", "Krawczyk", "Rabin"].map((lastName) => ({ firstName: "", lastName, creatorType: "author" })),
	});
	return item;
}

const GHKR_DOI = "10.1007/978-3-540-78967-3_6";

test("a preprint that CryptoBib lists as published becomes the published paper", async () => {
	const item = ghkrPreprint(env.Zotero);
	await env.Zotero.Attachments.importFromURL({ parentItemID: item.id, url: "https://eprint.iacr.org/2008/045.pdf", title: "PDF", contentType: "application/pdf" });

	const result = await env.run(item, env.versions.upgrade);
	assert.equal(result.status, "changed");
	assert.match(result.detail, /EUROCRYPT 2008 \(ePrint 2008\/045 kept\)/);
	assert.equal(item.itemType, "conferencePaper");
	assert.equal(item.getField("DOI"), GHKR_DOI);
	assert.equal(item.getField("conferenceName"), "EUROCRYPT 2008");
	assert.equal(item.getField("citationKey"), "EC:GHKR08");
	assert.equal(item.getField("pages"), "88-107");
	assert.notEqual(item.getField("publisher"), "Cryptology ePrint Archive", "the archive does not become the publisher");
	assert.equal(item.getField("url"), "", "the ePrint page is not the paper's URL");
	assert.match(item.getField("extra"), /^IACR ePrint: 2008\/045$/m, "the ePrint id is kept");
	assert.match(item.getField("abstractNote"), /threshold signatures/, "fields CryptoBib lacks are kept");
	assert.equal(item.attachments.length, 1, "the ePrint PDF stays");

	// Nothing left to do on the published paper.
	assert.equal((await env.run(item, env.versions.upgrade)).status, "skipped");
});

test("when the published version is already in the library, the preprint is linked to it instead", async () => {
	const preprint = ghkrPreprint(env.Zotero);
	const published = env.Zotero.addItem("conferencePaper", {
		fields: { title: "Threshold RSA for Dynamic and Ad-Hoc Groups", DOI: GHKR_DOI, date: "2008" },
		creators: [{ firstName: "Rosario", lastName: "Gennaro", creatorType: "author" }],
	});
	const result = await env.run(preprint, env.versions.upgrade);
	assert.equal(result.status, "changed");
	assert.match(result.detail, /already in the library.*\(linked\)/);
	assert.equal(preprint.itemType, "preprint", "no duplicate is made");
	assert.deepEqual(preprint.relatedItems, [published.key]);
	assert.deepEqual(published.relatedItems, [preprint.key]);
});

test("a preprint CryptoBib knows only as a preprint stays one", async () => {
	const item = env.Zotero.addItem("preprint", {
		fields: { title: "A Paper Nobody Has Published", archiveID: "2099/999", date: "2099" },
		creators: [{ firstName: "Ada", lastName: "Lovelace", creatorType: "author" }],
	});
	const result = await env.run(item, env.versions.upgrade);
	assert.equal(result.status, "unchanged");
	assert.equal(item.itemType, "preprint");
});

test("the ePrint and the published version are linked, by ePrint id or by title and authors", async () => {
	const published = env.Zotero.addItem("conferencePaper", {
		fields: { title: "Threshold RSA for Dynamic and Ad-Hoc Groups", DOI: GHKR_DOI, date: "2008", extra: "IACR ePrint: 2008/045" },
		creators: [{ firstName: "Rosario", lastName: "Gennaro", creatorType: "author" }],
	});
	const preprint = env.Zotero.addItem("preprint", {
		// A different title: only the shared ePrint id ties them together.
		fields: { title: "Threshold RSA in Ad-Hoc Groups (full version)", archiveID: "2008/045", date: "2007" },
	});
	const other = env.Zotero.addItem("conferencePaper", { fields: { title: "An Unrelated Paper About Lattices", date: "2022" } });

	const result = await env.run(published, env.versions.link);
	assert.equal(result.status, "changed");
	assert.deepEqual(published.relatedItems, [preprint.key]);
	assert.deepEqual(preprint.relatedItems, [published.key]);
	assert.equal((await env.run(preprint, env.versions.link)).status, "unchanged", "already linked");
	assert.equal((await env.run(other, env.versions.link)).status, "unchanged");
	assert.deepEqual(other.relatedItems, []);

	// By title and authors, years apart, when no ePrint id is stored.
	const journal = env.Zotero.addItem("journalArticle", {
		fields: { title: "Verifiable Decryption in the Head", date: "2024" },
		creators: [{ firstName: "Kristian", lastName: "Gjøsteen", creatorType: "author" }],
	});
	const eprint = env.Zotero.addItem("preprint", {
		fields: { title: "Verifiable decryption in the head", date: "2021" },
		creators: [{ firstName: "K.", lastName: "Gjosteen", creatorType: "author" }],
	});
	assert.equal((await env.run(eprint, env.versions.link)).status, "changed");
	assert.deepEqual(eprint.relatedItems, [journal.key]);
});

/** A paper with an ePrint PDF attached on `dateAdded`, and an ePrint page revised on `modified`. */
async function paperWithPdf({ modified, dateAdded = "2024-01-01 10:00:00", download } = {}) {
	env.store.dispose();
	rmSync(env.dataDirectory, { recursive: true, force: true });
	env = setup({ pages: { "2019/1047": eprintPage(modified) }, download });
	const item = env.Zotero.addItem("conferencePaper", { fields: { title: "Marlin", extra: "IACR ePrint: 2019/1047" } });
	const old = await env.Zotero.Attachments.importFromURL({
		parentItemID: item.id, url: "https://eprint.iacr.org/2019/1047.pdf", title: "IACR ePrint Full Text PDF", contentType: "application/pdf",
	});
	old.dateAdded = dateAdded;
	env.Zotero.files.set(old.getFilePath(), "old PDF");
	return { item, old };
}

test("an ePrint PDF attached after the last revision is up to date", async () => {
	const { item } = await paperWithPdf({ modified: "2023-10-04T20:12:07+00:00" });
	const result = await env.run(item, env.eprint.checkRevision);
	assert.equal(result.status, "unchanged");
	assert.match(result.detail, /up to date/);
	assert.equal(item.attachments.length, 1);
});

test("a revised ePrint PDF is added next to the old one, which keeps its date", async () => {
	const { item, old } = await paperWithPdf({ modified: "2024-10-04T20:12:07+00:00" });
	const result = await env.run(item, env.eprint.checkRevision);
	assert.equal(result.status, "changed");
	assert.match(result.detail, /2019\/1047: revised version of 2024-10-04/);
	assert.equal(item.attachments.length, 2);
	assert.equal(old.title, "IACR ePrint Full Text PDF (version of 2024-01-01)");
	assert.equal(item.attachments[1].title, "IACR ePrint Full Text PDF");
	assert.match(item.getField("extra"), /^IACR ePrint version: 2024-10-04T20:12:07\+00:00$/m);

	// The recorded revision now counts: checking again changes nothing.
	assert.equal((await env.run(item, env.eprint.checkRevision)).status, "unchanged");
	assert.equal(item.attachments.length, 2);
});

test("a revision with the same PDF is discarded, and the old PDF can be replaced instead of kept", async () => {
	const same = await paperWithPdf({ modified: "2024-10-04T20:12:07+00:00", download: () => "old PDF" });
	const result = await env.run(same.item, env.eprint.checkRevision);
	assert.equal(result.status, "unchanged");
	assert.match(result.detail, /the PDF is the same/);
	assert.equal(same.item.attachments.filter((a) => !a.deleted).length, 1);
	assert.equal(same.old.title, "IACR ePrint Full Text PDF", "the old PDF is untouched");

	const replaced = await paperWithPdf({ modified: "2024-10-04T20:12:07+00:00" });
	env.prefs.set("replaceRevisedEprint", true);
	assert.equal((await env.run(replaced.item, env.eprint.checkRevision)).status, "changed");
	assert.equal(replaced.old.deleted, true, "the old PDF went to the trash");
	assert.equal(replaced.item.attachments.filter((a) => !a.deleted).length, 1);
});

test("papers without an ePrint PDF are left to the download command", async () => {
	const item = env.Zotero.addItem("conferencePaper", { fields: { title: "X", extra: "IACR ePrint: 2019/1047" } });
	assert.equal((await env.run(item, env.eprint.checkRevision)).status, "skipped");
	assert.equal(env.http.requests.length, 0, "no page is fetched");
});

test("\\cite uses CryptoBib keys, and the export's keys for the other papers", async () => {
	const bernstein = env.Zotero.addItem("conferencePaper", {
		// No key stored yet: CryptoBib is searched by title and authors.
		fields: { title: "Proving Tight Security for Rabin-Williams Signatures", DOI: "10.1007/978-3-540-78967-3_5", date: "2008" },
		creators: [{ firstName: "Daniel J.", lastName: "Bernstein", creatorType: "author" }],
	});
	const preprint = ghkrPreprint(env.Zotero);
	const ownKey = env.Zotero.addItem("journalArticle", { fields: { title: "Something Else", citationKey: "smith2025else" } });
	const noKey = env.Zotero.addItem("journalArticle", {
		fields: { title: "Unpublished Musings", date: "2025" },
		creators: [{ firstName: "Ada", lastName: "Lovelace", creatorType: "author" }],
	});

	const cite = await env.latex.citeCommand([bernstein, preprint, ownKey, noKey, bernstein]);
	assert.equal(cite.text, "\\cite{EC:Bernstein08,EPRINT:GHKR08,smith2025else,lovelace2025}");
	assert.deepEqual([cite.keys, cite.notInCryptoBib, cite.withoutKey], [4, 2, 0]);
	assert.deepEqual(env.Zotero.exports, [LATEX.translators.bibTeX], "only the paper without any key needed an export");

	// With Better BibTeX, its pinned keys are used (and its translator).
	env.Zotero.BetterBibTeX = { KeyManager: { get: (id) => (id === noKey.id ? { citationKey: "LovelaceMusings" } : undefined) } };
	assert.equal((await env.latex.citeCommand([noKey])).text, "\\cite{LovelaceMusings}");
	assert.equal(env.latex.translatorID, LATEX.translators.betterBibTeX);
});

test("the BibTeX export holds only the papers CryptoBib lacks", async () => {
	const bernstein = env.Zotero.addItem("conferencePaper", { fields: { title: "Proving Tight Security", citationKey: "EC:Bernstein08" } });
	const other = env.Zotero.addItem("journalArticle", { fields: { title: "Something Else", citationKey: "smith2025else" } });

	const result = await env.latex.bibliographyNotInCryptoBib([bernstein, other], { header: "Line one\nLine two" });
	assert.deepEqual([result.exported, result.inCryptoBib], [1, 1]);
	assert.match(result.text, /^% Line one\n% Line two\n\n@journalArticle\{smith2025else,/);
	assert.doesNotMatch(result.text, /Bernstein/);

	const none = await env.latex.bibliographyNotInCryptoBib([bernstein], { header: "x" });
	assert.deepEqual([none.exported, none.inCryptoBib, none.text], [0, 1, ""]);
});
