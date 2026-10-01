import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CRYPTOBIB } from "../src/config.js";
import { eprintPaperFromPage } from "../src/core/eprint-page.js";
import { parseList } from "../src/core/list.js";
import { CryptoBibStore } from "../src/zotero/cryptobib-store.js";
import { createCryptoBibSyncAction } from "../src/zotero/cryptobib-sync.js";
import { EprintActions } from "../src/zotero/eprint.js";
import { cryptoBibSource, EprintFinder, iacrSearchSource } from "../src/zotero/eprint-sources.js";
import { itemsAsList } from "../src/zotero/list-export.js";
import { ListImporter } from "../src/zotero/list-import.js";
import { Pipeline } from "../src/zotero/pipeline.js";
import { Prefs } from "../src/zotero/prefs.js";
import { createFakeZotero } from "./fake-zotero.js";

const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

// --- Reading the list ------------------------------------------------------

test("a list mixes ePrint ids, DOIs, CryptoBib keys and titles, with comments and bullets", () => {
	const list = `
		# Papers on threshold signatures
		- 2008/045
		* https://eprint.iacr.org/2019/1234    # the full version
		1. 10.1007/978-3-540-78967-3_5
		EC:Bernstein08
		"Verifiable Decryption in the Head"
		Loquat: A SNARK-Friendly Signature — Zhang et al., 2024
		Cryptology ePrint Archive, Paper 2008/045
		%
	`;
	assert.deepEqual(parseList(list), [
		{ raw: "2008/045", eprintId: "2008/045" },
		{ raw: "https://eprint.iacr.org/2019/1234", eprintId: "2019/1234", hint: "the full version" },
		{ raw: "10.1007/978-3-540-78967-3_5", doi: "10.1007/978-3-540-78967-3_5" },
		{ raw: "EC:Bernstein08", key: "EC:Bernstein08" },
		{ raw: "Verifiable Decryption in the Head", title: "Verifiable Decryption in the Head" },
		{ raw: "Loquat: A SNARK-Friendly Signature — Zhang et al., 2024", title: "Loquat: A SNARK-Friendly Signature" },
	], "the repeated ePrint id is dropped");
});

test("a BibTeX bibliography is accepted as a list", () => {
	const entries = parseList(`
		@InProceedings{EC:GHKR08,
		  author = "Rosario Gennaro and Shai Halevi",
		  title = "Threshold {RSA} for Dynamic and Ad-Hoc Groups",
		  doi = "10.1007/978-3-540-78967-3_6",
		}
		@Misc{cryptoeprint:2019/1234,
		  title = "Something Newer",
		  howpublished = "Cryptology ePrint Archive, Paper 2019/1234",
		}
	`);
	assert.deepEqual(entries, [
		{ raw: "EC:GHKR08", eprintId: undefined, doi: "10.1007/978-3-540-78967-3_6", key: "EC:GHKR08", title: "Threshold RSA for Dynamic and Ad-Hoc Groups" },
		{ raw: "cryptoeprint:2019/1234", eprintId: "2019/1234", doi: undefined, key: undefined, title: "Something Newer" },
	]);
});

test("an ePrint paper page becomes an item through its meta tags", () => {
	const paper = eprintPaperFromPage("2024/1234", fakePage({
		citation_title: ["A Newer Paper on Lattices"],
		citation_author: ["Ada Lovelace", "Alan M. Turing"],
		citation_journal_title: ["Cryptology ePrint Archive"],
		"article:published_time": ["2024-08-03T14:51:25+00:00"],
		"og:description": ["We show something."],
		"article:tag": ["Lattice", "Signature", "Lattice"],
	}));
	assert.deepEqual(paper, {
		id: "2024/1234",
		title: "A Newer Paper on Lattices",
		creators: [
			{ firstName: "Ada", lastName: "Lovelace", creatorType: "author" },
			{ firstName: "Alan M.", lastName: "Turing", creatorType: "author" },
		],
		date: "2024-08-03",
		abstract: "We show something.",
		repository: "Cryptology ePrint Archive",
		tags: ["Lattice", "Signature"],
		url: "https://eprint.iacr.org/2024/1234",
	});
	assert.equal(eprintPaperFromPage("2024/1", fakePage({ "og:site_name": ["IACR"] })), null, "no title: no item");
});

/** A stand-in for a fetched HTML document with the given meta tags. */
function fakePage(tags) {
	const metas = Object.entries(tags).flatMap(([name, values]) => values.map((content) => ({
		getAttribute: (attribute) => ({ name, content, property: null })[attribute] ?? null,
	})));
	return { querySelectorAll: (selector) => (selector === "meta" ? metas : []) };
}

// --- Adding the papers -----------------------------------------------------

const EPRINT_PAGES = {
	"2099/999": fakePage({
		citation_title: ["A Paper CryptoBib Has Never Heard Of"],
		citation_author: ["Ada Lovelace"],
		"citation_publication_date": ["2099"],
		"og:description": ["An abstract."],
		"article:tag": ["Foundations"],
	}),
};

const SEARCH_RESULTS = {
	"eprint.iacr.org/search": {
		querySelectorAll: () => [{
			querySelector: (selector) => (selector === "a.paperlink"
				? { getAttribute: () => "/2099/999" }
				: { textContent: "A Paper CryptoBib Has Never Heard Of" }),
		}],
	},
};

let env;

function setup({ clipboard = "", translateDOI = () => null } = {}) {
	const Zotero = createFakeZotero({ clipboard, translateDOI });
	const prefs = new Prefs({ Zotero, Services: null });
	const dataDirectory = mkdtempSync(join(tmpdir(), "iacr-list-"));
	const log = (msg) => Zotero.logs.push(msg);
	const timers = { setTimeout: () => 0, clearTimeout: () => {} };
	const requested = [];
	const http = {
		async getText(url) {
			return url.endsWith(CRYPTOBIB.mainFile) ? fixture("crypto.bib") : fixture("abbrev0.bib");
		},
		getJSON: async () => {
			throw new Error("offline");
		},
		async getDocument(url) {
			requested.push(url);
			const page = Object.entries({ ...EPRINT_PAGES, ...SEARCH_RESULTS }).find(([key]) => url.includes(key));
			if (!page) throw new Error(`404 ${url}`);
			return page[1];
		},
	};
	const files = {
		join,
		exists: (path) => access(path).then(() => true, () => false),
		readText: (path) => readFile(path, "utf8"),
		writeText: (path, text) => writeFile(path, text),
		makeDirectory: (path) => mkdir(path, { recursive: true }).then(() => {}),
		stat: async () => ({ type: "regular", size: 0 }),
		children: async () => [],
		basename: (path) => path.split("/").pop(),
		md5: async () => false,
	};
	const store = new CryptoBibStore({ http, files, prefs, dataDirectory, timers, log });
	const pipeline = new Pipeline({ Zotero, store, log });
	const finder = new EprintFinder(() => [cryptoBibSource(store), iacrSearchSource(http)], log);
	const eprint = new EprintActions({ Zotero, prefs, finder });
	const importer = new ListImporter({
		Zotero, http, files, store, pipeline, finder, log,
		eprintKey: () => "IACR ePrint",
		suspendAutoProcessing: () => () => {},
	});
	const options = (overrides = {}) => ({
		libraryID: 1,
		collectionID: null,
		metadataActions: [createCryptoBibSyncAction(prefs)],
		eprintActions: [eprint.download],
		...overrides,
	});
	return { Zotero, store, importer, options, dataDirectory, requested };
}

beforeEach(() => {
	env = setup();
});

afterEach(() => {
	env.store.dispose();
	rmSync(env.dataDirectory, { recursive: true, force: true });
});

const byRaw = (summary) => Object.fromEntries(summary.map(({ entry, result }) => [entry.raw, result]));

test("papers are added from CryptoBib keys, ePrint ids and titles, with their ePrint PDFs", async () => {
	const entries = parseList(`
		EC:Bernstein08
		2008/045
		Verifiable Decryption in the Head
	`);
	const results = byRaw(await env.importer.run(entries, env.options()));

	// A CryptoBib key: the published paper, with its venue and citation key.
	const bernstein = results["EC:Bernstein08"];
	assert.equal(bernstein.status, "added");
	assert.equal(bernstein.item.itemType, "conferencePaper");
	assert.equal(bernstein.item.getField("citationKey"), "EC:Bernstein08");
	assert.equal(bernstein.item.getField("conferenceName"), "EUROCRYPT 2008");

	// An ePrint id that CryptoBib knows: the ePrint version, with its PDF.
	const eprint = results["2008/045"];
	assert.equal(eprint.status, "added");
	assert.equal(eprint.item.itemType, "preprint");
	assert.match(eprint.item.getField("extra"), /^IACR ePrint: 2008\/045$/m);
	assert.equal(eprint.item.attachments.length, 1, "ePrint PDF downloaded");
	assert.equal(eprint.item.attachments[0].url, "https://eprint.iacr.org/2008/045.pdf");

	// A title: matched in CryptoBib, then published metadata.
	const vdith = results["Verifiable Decryption in the Head"];
	assert.equal(vdith.status, "added");
	assert.equal(vdith.item.getField("citationKey"), "ACISP:GHMRS22");
	assert.match(vdith.detail, /CryptoBib/);
});

test("papers already in the library are left alone, but a missing ePrint PDF is fetched", async () => {
	const existing = env.Zotero.addItem("conferencePaper", {
		fields: { title: "Threshold RSA for Dynamic and Ad-Hoc Groups", date: "2008", DOI: "10.1007/978-3-540-78967-3_6" },
		creators: [{ firstName: "Rosario", lastName: "Gennaro", creatorType: "author" }],
	});
	const [first] = await env.importer.run(parseList("EC:GHKR08"), env.options());
	assert.equal(first.result.status, "updated");
	assert.equal(first.result.item, existing, "no second item is created");
	assert.match(existing.getField("extra"), /^IACR ePrint: 2008\/045$/m);
	assert.equal(existing.attachments.length, 1);

	// Nothing left to do the second time.
	const [again] = await env.importer.run(parseList("EC:GHKR08"), env.options());
	assert.equal(again.result.status, "exists");
	assert.equal(existing.attachments.length, 1, "the PDF is not downloaded twice");
});

test("a paper that CryptoBib does not know is taken from its ePrint page", async () => {
	const results = byRaw(await env.importer.run(parseList("2099/999\nA Paper CryptoBib Has Never Heard Of"), env.options()));
	const added = results["2099/999"];
	assert.equal(added.status, "added");
	assert.equal(added.item.itemType, "preprint");
	assert.equal(added.item.getField("title"), "A Paper CryptoBib Has Never Heard Of");
	assert.equal(added.item.getField("repository"), "Cryptology ePrint Archive");
	assert.equal(added.item.getField("date"), "2099");
	assert.equal(added.item.getField("abstractNote"), "An abstract.");
	assert.deepEqual(added.item.tags, ["Foundations"]);
	assert.equal(added.item.attachments.length, 1, "ePrint PDF downloaded");

	// The same paper by title: found through the ePrint search, then recognized as a duplicate.
	assert.equal(results["A Paper CryptoBib Has Never Heard Of"].status, "exists");
});

test("a DOI outside CryptoBib is looked up by Zotero, and nonsense is reported as not found", async () => {
	env.store.dispose();
	rmSync(env.dataDirectory, { recursive: true, force: true });
	env = setup({
		translateDOI: (doi) => (doi === "10.1145/1234567.1234568"
			? { itemType: "journalArticle", fields: { title: "A Paper From Another Publisher", date: "2015" } }
			: null),
	});
	const results = byRaw(await env.importer.run(
		parseList("10.1145/1234567.1234568\n10.9999/nope\nQuantum Widgets for Absolutely Nothing"),
		env.options({ eprintActions: [] }),
	));
	assert.equal(results["10.1145/1234567.1234568"].status, "added");
	assert.match(results["10.1145/1234567.1234568"].detail, /DOI lookup/);
	assert.equal(results["10.9999/nope"].status, "not-found");
	assert.equal(results["Quantum Widgets for Absolutely Nothing"].status, "not-found");
});

test("papers are filed in the chosen collection", async () => {
	const collection = new env.Zotero.Collection({ libraryID: 1, name: "Reading" });
	await collection.saveTx();
	const [{ result }] = await env.importer.run(parseList("EC:Bernstein08"), env.options({ collectionID: collection.id }));
	assert.ok(result.item.inCollection(collection.id));
});


// --- Copying papers out of the library -------------------------------------

test("papers are copied as a list that the import reads back", async () => {
	const { Zotero } = env;
	const items = [
		Zotero.addItem("preprint", { fields: { title: "Threshold RSA for Dynamic and Ad-Hoc Groups", extra: "IACR ePrint: 2008/045" } }),
		Zotero.addItem("conferencePaper", { fields: { title: "Proving Tight Security for Rabin-Williams Signatures", DOI: "10.1007/978-3-540-78967-3_5", citationKey: "EC:Bernstein08" } }),
		Zotero.addItem("journalArticle", { fields: { title: "A Paper With Only a Citation Key", citationKey: "JC:LibYun20" } }),
		Zotero.addItem("conferencePaper", { fields: { title: "A Paper With # Hashes and\nline breaks", citationKey: "not-a-cryptobib-key" } }),
		Zotero.addItem("document", { fields: { title: "" } }),
	];
	const text = itemsAsList(Zotero, items, { eprintKey: "IACR ePrint", header: "Papers from Zotero: Reading" });
	assert.equal(text, [
		"# Papers from Zotero: Reading",
		"2008/045                          # Threshold RSA for Dynamic and Ad-Hoc Groups",
		"10.1007/978-3-540-78967-3_5       # Proving Tight Security for Rabin-Williams Signatures",
		"JC:LibYun20                       # A Paper With Only a Citation Key",
		"A Paper With  Hashes and line breaks",
		"",
	].join("\n"), "the ePrint id wins, then the DOI, then a CryptoBib key, then the plain title");

	// What comes out goes back in: the same papers, no duplicates.
	const results = await env.importer.run(parseList(text), env.options({ eprintActions: [] }));
	assert.deepEqual(results.map((r) => r.result.status), ["exists", "exists", "added", "not-found"]);
	assert.equal(results[2].result.item.getField("citationKey"), "JC:LibYun20");
});

test("a wrong ePrint id falls back to the title written behind it", async () => {
	const results = await env.importer.run(
		parseList("2098/998  # Verifiable Decryption in the Head"),
		env.options({ eprintActions: [] }),
	);
	assert.equal(results[0].result.status, "added");
	assert.equal(results[0].result.item.getField("citationKey"), "ACISP:GHMRS22");
});
