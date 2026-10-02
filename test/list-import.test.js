import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CRYPTOBIB } from "../src/config.js";
import { eprintPaperFromPage } from "../src/core/eprint-page.js";
import { parseList, parseSection, relativeCollectionPath } from "../src/core/list.js";
import { CryptoBibStore } from "../src/zotero/cryptobib-store.js";
import { createCryptoBibSyncAction } from "../src/zotero/cryptobib-sync.js";
import { EprintActions } from "../src/zotero/eprint.js";
import { cryptoBibSource, EprintFinder, iacrSearchSource } from "../src/zotero/eprint-sources.js";
import { collectionAsList, itemsAsList } from "../src/zotero/list-export.js";
import { ListImporter } from "../src/zotero/list-import.js";
import { Pipeline } from "../src/zotero/pipeline.js";
import { Prefs } from "../src/zotero/prefs.js";
import { ZotMoovFiles } from "../src/zotero/zotmoov.js";
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

/** A ListImporter over the test environment, with its own files and auto-processing hooks. */
function importerWith({ files, suspendAutoProcessing }) {
	const { pipeline, finder, http, store } = env.importer;
	return new ListImporter({
		Zotero: env.Zotero, http, files, store, pipeline, finder, log: () => {},
		eprintKey: () => "IACR ePrint",
		suspendAutoProcessing,
	});
}

test("automatic processing resumes even when the library cannot be read", async () => {
	let suspended = 0;
	const importer = importerWith({
		files: env.importer.files,
		suspendAutoProcessing: () => {
			suspended++;
			return () => suspended--;
		},
	});
	env.Zotero.Items.getAll = async () => {
		throw new Error("database is locked");
	};
	await assert.rejects(importer.run(parseList("EC:Bernstein08"), env.options()), /database is locked/);
	assert.equal(suspended, 0);
});

test("the list import does not look at the library's files", async () => {
	const paper = env.Zotero.addItem("journalArticle", { fields: { title: "Some Paper" } });
	env.Zotero.addPDF({ path: "/library/some-paper.pdf", parentItemID: paper.id });
	let stats = 0;
	const importer = importerWith({
		files: { ...env.importer.files, stat: async () => (stats++, { type: "regular", size: 1 }) },
		suspendAutoProcessing: () => () => {},
	});
	const [{ result }] = await importer.run(parseList("EC:Bernstein08"), env.options());
	assert.equal(result.status, "added");
	assert.equal(stats, 0);
});

test("entries are looked up in parallel, and a paper listed twice is added and downloaded once", async () => {
	const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	let inFlight = 0;
	let maxInFlight = 0;
	const { http } = env.importer;
	const getDocument = http.getDocument.bind(http);
	http.getDocument = async (url) => {
		maxInFlight = Math.max(maxInFlight, ++inFlight);
		await delay(10);
		inFlight--;
		return getDocument(url);
	};
	const { Attachments } = env.Zotero;
	const importFromURL = Attachments.importFromURL.bind(Attachments);
	Attachments.importFromURL = async (options) => {
		await delay(10);
		return importFromURL(options);
	};

	const entries = parseList("2008/045\nEPRINT:GHKR08\nEC:Bernstein08\nJC:LibYun20\nC:ZSELLR24\nACISP:GHMRS22");
	const done = [];
	const summary = await env.importer.run(entries, env.options(), { onEntryDone: (entry) => done.push(entry.raw) });

	assert.deepEqual(summary.map(({ entry }) => entry.raw), entries.map((entry) => entry.raw), "results in list order");
	assert.equal(done.length, entries.length);
	assert.ok(maxInFlight > 1 && maxInFlight <= 4, `${maxInFlight} lookups at once`);

	const twice = byRaw(summary);
	const statuses = [twice["2008/045"].status, twice["EPRINT:GHKR08"].status].sort();
	assert.deepEqual(statuses, ["added", "exists"]);
	assert.equal(twice["2008/045"].item, twice["EPRINT:GHKR08"].item, "one item for both entries");
	assert.equal(twice["2008/045"].item.attachments.length, 1, "its PDF is downloaded once");
});

test("Stop leaves the remaining entries alone", async () => {
	let stop = false;
	const entries = parseList("EC:Bernstein08\nJC:LibYun20\nC:ZSELLR24\nACISP:GHMRS22\n2008/045\nEC:GHKR08");
	const summary = await env.importer.run(entries, env.options({ eprintActions: [] }), {
		onEntryDone: () => (stop = true),
		shouldStop: () => stop,
	});
	// Entries already started finish; no new one starts after the first is done.
	assert.ok(summary.length >= 1 && summary.length <= 4, `${summary.length} entries processed`);
	assert.ok(summary.every(({ result }) => result.status === "added"));
	const added = (await env.Zotero.Items.getAll(1)).filter((item) => item.isRegularItem());
	assert.equal(added.length, summary.length, "nothing was added for the entries never started");
});


// --- Sections: lists that file papers into subcollections -------------------

test("section lines put the papers below them into subcollections", () => {
	const entries = parseList(`
		# Papers for the project
		EC:Bernstein08
		[Signatures]
		- 2008/045                # Threshold RSA
		[Signatures / Lattice]    # a comment after a section
		JC:LibYun20
		[2024/1234]
		[Phd → Project → Threshold]
		EC:Bernstein08
		[]
		ACISP:GHMRS22
	`);
	assert.deepEqual(entries, [
		{ raw: "EC:Bernstein08", key: "EC:Bernstein08", collections: [[], ["Phd", "Project", "Threshold"]] },
		{ raw: "2008/045", eprintId: "2008/045", hint: "Threshold RSA", collections: [["Signatures"]] },
		{ raw: "JC:LibYun20", key: "JC:LibYun20", collections: [["Signatures", "Lattice"]] },
		{ raw: "2024/1234", eprintId: "2024/1234", collections: [["Signatures", "Lattice"]] },
		{ raw: "ACISP:GHMRS22", key: "ACISP:GHMRS22", collections: [[]] },
	], "a bracketed ePrint id is a paper; a paper listed twice keeps both places; [] is the target itself");
	assert.deepEqual(parseSection("[PRF/PRP > Tight]"), ["PRF/PRP", "Tight"], "a slash without spaces belongs to the name");
	assert.equal(parseSection("[EC:Bernstein08]"), null);
	assert.equal(parseList("2008/045").at(0).collections, undefined, "a list without sections has no collections");
});

test("a section may name the target collection's own path, which is dropped", () => {
	const base = ["Phd", "Project"];
	assert.deepEqual(relativeCollectionPath(["Phd", "Project", "Topic"], base), ["Topic"]);
	assert.deepEqual(relativeCollectionPath(["project", "Topic"], base), ["Topic"], "names compare without case");
	assert.deepEqual(relativeCollectionPath(["Topic", "Sub"], base), ["Topic", "Sub"]);
	assert.deepEqual(relativeCollectionPath(["Phd", "Other", "Topic"], base), ["Phd", "Other", "Topic"]);
	assert.deepEqual(relativeCollectionPath(["Topic"], []), ["Topic"]);
});

/** Collections "Phd → Project" (plus the given children of Project). */
async function projectCollections(...children) {
	const { Zotero } = env;
	const make = async (name, parentID) => {
		const collection = new Zotero.Collection({ libraryID: 1, name, ...(parentID ? { parentID } : {}) });
		await collection.saveTx();
		return collection;
	};
	const phd = await make("Phd");
	const project = await make("Project", phd.id);
	const sub = {};
	for (const name of children) sub[name] = await make(name, project.id);
	return { phd, project, sub, make };
}

const bernstein = () => env.Zotero.addItem("conferencePaper", {
	fields: { title: "Proving Tight Security for Rabin-Williams Signatures", date: "2008", DOI: "10.1007/978-3-540-78967-3_5" },
	creators: [{ firstName: "Daniel J.", lastName: "Bernstein", creatorType: "author" }],
});
const libertYung = () => env.Zotero.addItem("journalArticle", {
	fields: { title: "Adaptively Secure Non-interactive CCA-Secure Threshold Cryptosystems", date: "2020", DOI: "10.1007/s00145-020-09350-3" },
	creators: [{ firstName: "Benoît", lastName: "Libert", creatorType: "author" }],
});

test("a list with sections files new papers into subcollections, creating the missing ones", async () => {
	const { project, sub } = await projectCollections("Signatures");
	const summary = byRaw(await env.importer.run(parseList(`
		[signatures]
		EC:Bernstein08
		[Phd → Project → Threshold / Lattice]
		JC:LibYun20
		[]
		ACISP:GHMRS22
	`), env.options({ collectionID: project.id, eprintActions: [] })));

	assert.deepEqual(env.Zotero.collectionPaths(), ["Phd", "Phd/Project", "Phd/Project/Signatures", "Phd/Project/Threshold", "Phd/Project/Threshold/Lattice"],
		"the existing subcollection is reused regardless of case; the full path is understood");
	const lattice = env.Zotero.Collections.getByParent(env.Zotero.Collections.getByParent(project.id).find((c) => c.name === "Threshold").id)[0];
	assert.deepEqual(summary["EC:Bernstein08"].item.getCollections(), [sub.Signatures.id]);
	assert.deepEqual(summary["JC:LibYun20"].item.getCollections(), [lattice.id]);
	assert.deepEqual(summary["ACISP:GHMRS22"].item.getCollections(), [project.id]);
	assert.ok(Object.values(summary).every((result) => result.status === "added"));
});

test("without reorganizing, papers already in the library are added to their sections and stay where they are", async () => {
	const { project, sub } = await projectCollections("Signatures", "Threshold");
	const paper = bernstein();
	paper.setCollections([project.id]);
	const [{ result }] = await env.importer.run(parseList("[Threshold]\nEC:Bernstein08"), env.options({ collectionID: project.id, eprintActions: [] }));
	assert.equal(result.status, "exists");
	assert.equal(result.detail, "added to \u201cThreshold\u201d");
	assert.deepEqual(paper.getCollections().sort(), [project.id, sub.Threshold.id].sort());
	assert.equal(result.refiledTo, undefined);
});

test("reorganizing moves papers within the target collection to the sections the list names", async () => {
	const { project, sub, make } = await projectCollections("Signatures", "Threshold");
	const other = await make("Other project");
	const unfiled = bernstein();
	unfiled.setCollections([project.id]);
	const misfiled = libertYung();
	misfiled.setCollections([sub.Signatures.id, other.id]);
	const twice = env.Zotero.addItem("conferencePaper", {
		fields: { title: "Threshold RSA for Dynamic and Ad-Hoc Groups", date: "2008", DOI: "10.1007/978-3-540-78967-3_6" },
		creators: [{ firstName: "Rosario", lastName: "Gennaro", creatorType: "author" }],
	});
	twice.setCollections([project.id]);
	const unlisted = env.Zotero.addItem("journalArticle", { fields: { title: "Not on the list" } });
	unlisted.setCollections([sub.Signatures.id]);

	const summary = byRaw(await env.importer.run(parseList(`
		[Signatures]
		EC:Bernstein08
		EC:GHKR08
		[Threshold]
		JC:LibYun20
		EC:GHKR08
	`), env.options({ collectionID: project.id, reorganize: true, eprintActions: [] })));

	assert.equal(summary["EC:Bernstein08"].status, "moved");
	assert.equal(summary["EC:Bernstein08"].detail, "moved from \u201cProject\u201d to \u201cSignatures\u201d");
	assert.deepEqual(unfiled.getCollections(), [sub.Signatures.id]);
	assert.equal(summary["EC:Bernstein08"].refiledTo, sub.Signatures.id, "its files may follow");

	assert.equal(summary["JC:LibYun20"].status, "moved");
	assert.deepEqual(misfiled.getCollections().sort(), [other.id, sub.Threshold.id].sort(), "collections outside the project are left alone");
	assert.equal(summary["JC:LibYun20"].refiledTo, undefined, "another project still holds it, so its files stay");

	assert.deepEqual(twice.getCollections().sort(), [sub.Signatures.id, sub.Threshold.id].sort(), "a paper listed in two sections stays in both");
	assert.deepEqual(unlisted.getCollections(), [sub.Signatures.id], "papers the list does not name are left alone");

	// Running the same list again changes nothing.
	const again = await env.importer.run(parseList("[Signatures]\nEC:Bernstein08"), env.options({ collectionID: project.id, reorganize: true, eprintActions: [] }));
	assert.equal(again[0].result.status, "exists");
	assert.equal(again[0].result.detail, undefined);
});

test("a collection is copied as a list with a section per subcollection, which imports back into place", async () => {
	const { project, sub, make } = await projectCollections("Signatures", "Threshold");
	const lattice = await make("Lattice", sub.Threshold.id);
	const unfiled = bernstein();
	unfiled.setCollections([project.id]);
	const shared = libertYung();
	shared.setCollections([sub.Signatures.id, lattice.id]);

	const { text, count } = collectionAsList(env.Zotero, project, { eprintKey: "IACR ePrint", header: "Papers from Zotero: Project" });
	assert.equal(text, [
		"# Papers from Zotero: Project",
		"10.1007/978-3-540-78967-3_5       # Proving Tight Security for Rabin-Williams Signatures",
		"",
		"[Signatures]",
		"10.1007/s00145-020-09350-3        # Adaptively Secure Non-interactive CCA-Secure Threshold Cryptosystems",
		"",
		"[Threshold / Lattice]",
		"10.1007/s00145-020-09350-3        # Adaptively Secure Non-interactive CCA-Secure Threshold Cryptosystems",
		"",
	].join("\n"), "empty subcollections are left out");
	assert.equal(count, 2, "a paper in two sections counts once");

	// Imported into a fresh collection, the list rebuilds the structure.
	const copy = await make("Copy");
	const results = await env.importer.run(parseList(text), env.options({ collectionID: copy.id, eprintActions: [] }));
	assert.deepEqual(results.map((r) => r.result.status), ["exists", "exists"]);
	assert.ok(env.Zotero.collectionPaths().includes("Copy/Threshold/Lattice"));
	assert.equal(shared.getCollections().length, 4, "added to the copy's sections as well");
});

test("ZotMoov moves the files it manages into the folder of the paper's new collection", async () => {
	const { Zotero } = env;
	const calls = [];
	Zotero.Attachments.LINK_MODE_LINKED_FILE = 2;
	Zotero.ZotMoov = {
		getBasePrefs: () => ({ into_subfolder: true, subdir_str: "{%c}", preferred_collection: 99 }),
		async move(attachments, directory, options) {
			calls.push({ attachments: attachments.map((a) => a.id), directory, options });
		},
	};
	const paper = bernstein();
	const linked = Zotero.addPDF({ path: "C:/Zotero/Phd/Project/paper.pdf", linked: true, parentItemID: paper.id });
	linked.attachmentLinkMode = 2;
	const stored = Zotero.addPDF({ path: "/storage/new.pdf", parentItemID: paper.id });
	stored.attachmentLinkMode = 0;
	const files = new ZotMoovFiles({ Zotero, log: () => {} });

	assert.equal(files.available, false, "not without ZotMoov's settings");
	Zotero.Prefs.set("extensions.zotmoov.dst_dir", "C:/Zotero");
	Zotero.Prefs.set("extensions.zotmoov.file_behavior", "copy");
	Zotero.Prefs.set("extensions.zotmoov.enable_subdir_move", true);
	assert.equal(files.available, false, "not when ZotMoov copies files");
	Zotero.Prefs.set("extensions.zotmoov.file_behavior", "move");
	assert.equal(files.available, true);

	assert.equal(await files.moveFiles([{ item: paper, collectionID: 42 }]), 1);
	assert.deepEqual(calls, [{
		attachments: [linked.id],
		directory: "C:/Zotero",
		options: { into_subfolder: true, subdir_str: "{%c}", preferred_collection: 42 },
	}], "only the linked file; ZotMoov handles new stored files itself");
});
