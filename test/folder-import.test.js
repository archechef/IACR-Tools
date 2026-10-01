import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { access, copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { CRYPTOBIB } from "../src/config.js";
import { MacroTable } from "../src/core/bibtex.js";
import { buildRecords, CryptoBibIndex } from "../src/core/cryptobib.js";
import { eprintIdFromFileName, identifiersInText, identifyInCryptoBib, textContainsTitle } from "../src/core/pdf-text.js";
import { AutoProcessor } from "../src/zotero/auto-processor.js";
import { CryptoBibStore } from "../src/zotero/cryptobib-store.js";
import { createCryptoBibSyncAction } from "../src/zotero/cryptobib-sync.js";
import { EprintActions } from "../src/zotero/eprint.js";
import { cryptoBibSource, EprintFinder } from "../src/zotero/eprint-sources.js";
import { FolderImporter } from "../src/zotero/folder-import.js";
import { Pipeline } from "../src/zotero/pipeline.js";
import { Prefs } from "../src/zotero/prefs.js";
import { convertSpringerAction } from "../src/zotero/springer.js";
import { resolveImportTarget } from "../src/ui/target.js";
import { createFakeZotero } from "./fake-zotero.js";

const pick = ({ collection, libraryID, source }) => ({ collection, libraryID, source });

const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

async function loadIndex() {
	return new CryptoBibIndex(await buildRecords(fixture("crypto.bib"), new MacroTable().load(fixture("abbrev0.bib"))));
}

// --- Identifying PDFs from their file name and text ------------------------

test("ePrint ids are read from file names as saved from eprint.iacr.org", () => {
	assert.equal(eprintIdFromFileName("2008-045.pdf"), "2008/045");
	assert.equal(eprintIdFromFileName("eprint_2023_1234.pdf"), "2023/1234");
	assert.equal(eprintIdFromFileName("2008-045 Threshold RSA.pdf"), "2008/045");
	assert.equal(eprintIdFromFileName("1234-567.pdf"), null);
	assert.equal(eprintIdFromFileName("smith2008.pdf"), null);
});

test("DOIs and ePrint ids are found in running text", () => {
	const text = "Springer (https://doi.org/10.1007/978-3-540-78967-3_5). Full version: Cryptology ePrint Archive, Paper 2008/45, see also eprint.iacr.org/2008/045.";
	assert.deepEqual(identifiersInText(text), { dois: ["10.1007/978-3-540-78967-3_5"], eprintIds: ["2008/045"] });
	assert.deepEqual(identifiersInText("(Goldwasser, Micali: JCSS, doi:10.1016/0022-0000(84)90070-9).").dois,
		["10.1016/0022-0000(84)90070-9"]);
});

test("titles are found in PDF text despite line breaks, hyphenation and case", () => {
	const text = "PROVING TIGHT SECURITY FOR RABIN-\nWILLIAMS SIGNATURES\nDaniel J. Bernstein";
	assert.ok(textContainsTitle(text, "Proving Tight Security for Rabin-Williams Signatures"));
	assert.ok(!textContainsTitle(text, "Threshold RSA for Dynamic and Ad-Hoc Groups"));
	assert.ok(!textContainsTitle(text, ""));
});

test("CryptoBib identifies a PDF only when its title confirms the identifier", async () => {
	const index = await loadIndex();
	const page = "Threshold RSA for Dynamic and Ad-Hoc Groups\nRosario Gennaro ...";
	assert.equal(identifyInCryptoBib(index, "paper.pdf", `${page} doi:10.1007/978-3-540-78967-3_6`)?.key, "EC:GHKR08");
	// A DOI of a cited paper: its title is not on the page.
	assert.equal(identifyInCryptoBib(index, "paper.pdf", `${page} [3] doi:10.1007/978-3-540-78967-3_5`), null);
	assert.equal(identifyInCryptoBib(index, "2008-045.pdf", page)?.key, "EPRINT:GHKR08");
	assert.equal(identifyInCryptoBib(index, "2008-045.pdf", "")?.key, "EPRINT:GHKR08", "no text to check");
	assert.equal(identifyInCryptoBib(index, "2008-045.pdf", "Some other paper"), null);
	assert.equal(identifyInCryptoBib(index, "x.pdf", `${page} ePrint Archive, Report 2008/045`)?.key, "EPRINT:GHKR08");
});

// --- Importing a folder ----------------------------------------------------

const nodeFiles = {
	join,
	exists: (path) => access(path).then(() => true, () => false),
	readText: (path) => readFile(path, "utf8"),
	writeText: (path, text) => writeFile(path, text),
	makeDirectory: (path) => mkdir(path, { recursive: true }).then(() => {}),
	async stat(path) {
		const s = await stat(path);
		return { type: s.isDirectory() ? "directory" : s.isFile() ? "regular" : "other", size: s.size };
	},
	children: async (path) => (await readdir(path)).map((name) => join(path, name)),
	basename,
	md5: async (path) => createHash("md5").update(await readFile(path)).digest("hex"),
};

/** Metadata that Zotero's recognizer returns for the test PDFs (by file content). */
const RECOGNIZED = {
	bernstein: {
		itemType: "bookSection",
		fields: { title: "Proving Tight Security for Rabin-Williams Signatures", bookTitle: "EUROCRYPT 2008", date: "2008", DOI: "", extra: "DOI: 10.1007/978-3-540-78967-3_5" },
		creators: [{ firstName: "Daniel J.", lastName: "Bernstein", creatorType: "author" }],
	},
	ghkr: {
		itemType: "bookSection",
		fields: { title: "Threshold RSA for Dynamic and Ad-Hoc Groups", bookTitle: "EUROCRYPT 2008", date: "2008", extra: "DOI: 10.1007/978-3-540-78967-3_6" },
		creators: [{ firstName: "Rosario", lastName: "Gennaro", creatorType: "author" }],
	},
};

const TEXT = {
	loquat: "Loquat: A SNARK-Friendly Post-quantum Signature based on the Legendre PRF with Applications in Ring and Aggregate Signatures\nhttps://doi.org/10.1007/978-3-031-68376-3_1",
};

let env;

async function setup() {
	const root = mkdtempSync(join(tmpdir(), "iacr-folder-"));
	const storage = join(root, "storage");
	const folder = join(root, "papers");
	const write = async (path, content) => {
		await mkdir(dirname(join(folder, path)), { recursive: true });
		await writeFile(join(folder, path), content);
	};
	const contentOf = (attachment) => readFileSync(attachment.path, "utf8");
	let stored = 0;
	const Zotero = createFakeZotero({
		recognize: (attachment) => RECOGNIZED[contentOf(attachment)] ?? null,
		fullText: (attachment) => TEXT[contentOf(attachment)] ?? "",
		async storeFile(path) {
			const target = join(storage, `S${++stored}`, basename(path));
			await mkdir(dirname(target), { recursive: true });
			await copyFile(path, target);
			return target;
		},
	});
	const prefs = new Prefs({ Zotero, Services: null });
	const dataDirectory = join(root, "data");
	const log = (msg) => Zotero.logs.push(msg);
	const timers = { setTimeout: () => 0, clearTimeout: () => {} };
	const http = {
		async getText(url) {
			if (url.endsWith(CRYPTOBIB.mainFile)) return fixture("crypto.bib");
			return fixture("abbrev0.bib");
		},
		getJSON: async () => { throw new Error("offline"); },
		getDocument: async () => { throw new Error("offline"); },
	};
	const store = new CryptoBibStore({ http, files: nodeFiles, prefs, dataDirectory, timers, log });
	const pipeline = new Pipeline({ Zotero, store, log });
	const eprint = new EprintActions({ Zotero, prefs, finder: new EprintFinder(() => [cryptoBibSource(store)], log) });
	const autoTimers = { scheduled: 0, setTimeout: () => ++autoTimers.scheduled, clearTimeout: () => {} };
	const autoProcessor = new AutoProcessor({ Zotero, pipeline, enabledActions: () => [convertSpringerAction], timers: autoTimers, log });
	const importer = new FolderImporter({
		Zotero, files: nodeFiles, store, pipeline, log,
		eprintKey: () => "IACR ePrint",
		suspendAutoProcessing: () => autoProcessor.suspend(),
	});
	const options = (overrides = {}) => ({
		collectionID: null,
		subcollections: true,
		link: false,
		attachToExisting: true,
		metadataActions: [convertSpringerAction, createCryptoBibSyncAction(prefs)],
		eprintActions: [eprint.find],
		...overrides,
	});
	return { root, folder, write, Zotero, importer, options, autoProcessor, autoTimers, store };
}

beforeEach(async () => {
	env = await setup();
});

afterEach(() => {
	env.store.dispose();
	rmSync(env.root, { recursive: true, force: true });
});

/** Library: Bernstein08 without PDF, "Verifiable Decryption in the Head" with its PDF. */
async function populateLibrary() {
	const { Zotero, root } = env;
	const bernstein = Zotero.addItem("conferencePaper", {
		fields: { title: "Proving Tight Security for Rabin-Williams Signatures", date: "2008", DOI: "10.1007/978-3-540-78967-3_5" },
		creators: [{ firstName: "Daniel J.", lastName: "Bernstein", creatorType: "author" }],
	});
	const vdith = Zotero.addItem("conferencePaper", {
		fields: { title: "Verifiable Decryption in the Head", date: "2022" },
		creators: [{ firstName: "Kristian", lastName: "Gjøsteen", creatorType: "author" }],
	});
	await mkdir(join(root, "library"), { recursive: true });
	await writeFile(join(root, "library", "vdith.pdf"), "vdith");
	Zotero.addPDF({ path: join(root, "library", "vdith.pdf"), parentItemID: vdith.id });
	return { bernstein, vdith };
}

async function populateFolder() {
	await env.write("bernstein.pdf", "bernstein");
	await env.write("sub/ghkr.pdf", "ghkr");
	await env.write("sub/ghkr (copy).pdf", "ghkr");
	await env.write("sub/deeper/vdith-download.PDF", "vdith");
	await env.write("loquat.pdf", "loquat");
	await env.write("mystery.pdf", "mystery");
	await env.write(".hidden.pdf", "hidden");
	await env.write("notes.txt", "notes");
}

const byName = (summary) => Object.fromEntries(summary.map(({ file, result }) => [file.name, result]));

test("a folder scan finds the PDFs of all subfolders and the files the library already has", async () => {
	const { vdith } = await populateLibrary();
	await populateFolder();
	const plan = await env.importer.scan(env.folder, 1);
	const statuses = Object.fromEntries(plan.files.map((f) => [f.name, f.status]));
	assert.deepEqual(statuses, {
		"bernstein.pdf": "new",
		"loquat.pdf": "new",
		"mystery.pdf": "new",
		"vdith-download.PDF": "exists",
		"ghkr (copy).pdf": "new",
		"ghkr.pdf": "repeat",
	});
	assert.equal(plan.files.find((f) => f.status === "exists").existing, vdith);
	assert.equal(plan.folderName, "papers");
	assert.equal(env.Zotero.RecognizeDocument.recognized.length, 0, "scanning changes nothing");
});

test("importing a folder adds new papers, skips known ones and looks up ePrint versions", async () => {
	const { bernstein, vdith } = await populateLibrary();
	await populateFolder();
	const plan = await env.importer.scan(env.folder, 1);
	const done = [];
	const results = byName(await env.importer.run(plan, env.options(), { onFileDone: (file) => done.push(file.name) }));
	assert.equal(done.length, 6);

	// Already in the library without a PDF: the PDF is added to the existing item.
	assert.equal(results["bernstein.pdf"].status, "attached");
	assert.equal(results["bernstein.pdf"].item, bernstein);
	assert.equal(bernstein.attachments.length, 1);

	// New Springer paper: converted, updated from CryptoBib, ePrint version found.
	const ghkr = results["ghkr (copy).pdf"];
	assert.equal(ghkr.status, "imported");
	assert.equal(ghkr.item.itemType, "conferencePaper");
	assert.equal(ghkr.item.getField("citationKey"), "EC:GHKR08");
	assert.match(ghkr.item.getField("extra"), /^IACR ePrint: 2008\/045$/m);
	assert.match(ghkr.detail, /2008\/045/);

	// Identical file elsewhere in the folder, and a file the library already has.
	assert.equal(results["ghkr.pdf"].status, "repeat");
	assert.equal(results["vdith-download.PDF"].status, "exists");
	assert.equal(results["vdith-download.PDF"].item, vdith);

	// Not recognized by Zotero, but its DOI and title are in CryptoBib.
	const loquat = results["loquat.pdf"];
	assert.equal(loquat.status, "imported");
	assert.equal(loquat.item.getField("citationKey"), "C:ZSELLR24");
	assert.equal(loquat.item.getField("DOI"), "10.1007/978-3-031-68376-3_1");
	assert.equal(loquat.item.attachments.length, 1);

	// Neither recognized nor in CryptoBib: kept as a standalone PDF.
	assert.equal(results["mystery.pdf"].status, "unrecognized");
	assert.equal(results["mystery.pdf"].item.parentItemID, null);

	// The folder tree is mirrored as collections, and every item is filed in its folder's collection.
	assert.deepEqual(env.Zotero.collectionPaths(), ["papers", "papers/sub", "papers/sub/deeper"]);
	const collectionNamed = (name) => [...env.Zotero.Collections.getByLibrary(1), ...env.Zotero.Collections.getByParent(env.Zotero.Collections.getByLibrary(1)[0].id)]
		.find((c) => c.name === name);
	assert.ok(ghkr.item.inCollection(collectionNamed("sub").id));
	assert.ok(bernstein.inCollection(collectionNamed("papers").id));
	assert.ok(results["mystery.pdf"].item.inCollection(collectionNamed("papers").id));
});

test("importing the same folder again adds nothing and reuses the collections", async () => {
	await populateLibrary();
	await populateFolder();
	await env.importer.run(await env.importer.scan(env.folder, 1), env.options());
	const plan = await env.importer.scan(env.folder, 1);
	// Every file now matches a stored copy (the repeated one matches the copy of its twin).
	assert.deepEqual(plan.files.map((f) => f.status), Array(6).fill("exists"));
	await env.importer.run(plan, env.options());
	assert.deepEqual(env.Zotero.collectionPaths(), ["papers", "papers/sub", "papers/sub/deeper"]);
});

test("a paper that is already in the library with a PDF goes to the trash", async () => {
	const { bernstein } = await populateLibrary();
	await env.write("bernstein.pdf", "bernstein");
	const results = byName(await env.importer.run(await env.importer.scan(env.folder, 1), env.options({ attachToExisting: false })));
	assert.equal(results["bernstein.pdf"].status, "exists");
	assert.equal(bernstein.attachments.length, 0);
	const trashed = [...(await env.Zotero.Items.getAll(1))].filter((item) => item.deleted);
	assert.equal(trashed.length, 2, "new parent and its PDF");
});

test("two PDFs of the same paper in one folder are imported once", async () => {
	await env.write("a/ghkr-springer.pdf", "ghkr");
	await env.write("b/ghkr-other-print.pdf", "ghkr\n");
	RECOGNIZED["ghkr\n"] = RECOGNIZED.ghkr;
	try {
		const results = await env.importer.run(await env.importer.scan(env.folder, 1), env.options({ subcollections: false }));
		assert.deepEqual(results.map((r) => r.result.status), ["imported", "exists"]);
	}
	finally {
		delete RECOGNIZED["ghkr\n"];
	}
});

test("linked files are recognized by their path, and link mode applies to My Library only", async () => {
	await env.write("ghkr.pdf", "ghkr");
	const [{ result }] = await env.importer.run(await env.importer.scan(env.folder, 1), env.options({ link: true, eprintActions: [] }));
	const [pdf] = result.item.attachments;
	assert.equal(pdf.linked, true);
	assert.equal(pdf.path, join(env.folder, "ghkr.pdf"));
	assert.equal((await env.importer.scan(env.folder, 1)).files[0].status, "exists");

	await env.write("group/loquat.pdf", "loquat");
	const plan = await env.importer.scan(join(env.folder, "group"), 2);
	const [{ result: groupResult }] = await env.importer.run(plan, env.options({ link: true, subcollections: false }));
	assert.equal(groupResult.item.attachments[0].linked, false);
	assert.equal(groupResult.item.libraryID, 2);
});

test("automatic processing is suspended while a folder is imported", async () => {
	await env.write("ghkr.pdf", "ghkr");
	const plan = await env.importer.scan(env.folder, 1);
	env.autoProcessor.start();
	let pendingDuringRun = 0;
	const originalRun = env.importer.pipeline.run.bind(env.importer.pipeline);
	env.importer.pipeline.run = async (...args) => {
		env.Zotero.Notifier.trigger("add", "item", [12345]);
		pendingDuringRun++;
		return originalRun(...args);
	};
	await env.importer.run(plan, env.options());
	assert.ok(pendingDuringRun > 0);
	assert.equal(env.autoTimers.scheduled, 0, "new items were ignored");
	env.Zotero.Notifier.trigger("add", "item", [12345]);
	assert.equal(env.autoTimers.scheduled, 1, "resumed afterwards");
	env.autoProcessor.stop();
});

// --- Which library and collection the import goes into ----------------------

const fakeZoteroWithPane = (pane) => ({
	getMainWindow: () => ({ ZoteroPane: pane }),
	Libraries: { userLibraryID: 1 },
});

test("the target collection is read from whichever accessors the Zotero version has", () => {
	const collection = { id: 7, name: "Crypto", libraryID: 3 };
	const row = { isCollection: () => true, ref: collection };

	// Zotero versions with multiple selection.
	assert.deepEqual(pick(resolveImportTarget(fakeZoteroWithPane({
		getSelectedCollections: () => [collection],
		getSelectedLibraryIDs: () => [3],
	}))), { collection, libraryID: 3, source: "getSelectedCollections" });

	// Older versions: only the singular accessors exist.
	assert.deepEqual(pick(resolveImportTarget(fakeZoteroWithPane({
		getSelectedCollection: () => collection,
		getSelectedLibraryID: () => 3,
	}))), { collection, libraryID: 3, source: "getSelectedCollection" });

	// Neither: fall back to the selected row of the collection tree.
	assert.deepEqual(pick(resolveImportTarget(fakeZoteroWithPane({
		collectionsView: { selectedTreeRow: row },
	}))), { collection, libraryID: 3, source: "selectedTreeRow" });

	// Right-clicking a collection passes it in the menu context.
	assert.deepEqual(pick(resolveImportTarget(fakeZoteroWithPane({}), { collectionTreeRow: row })),
		{ collection, libraryID: 3, source: "menu context" });
});

test("a library row, a throwing accessor or no window leave the import at the library root", () => {
	const throwing = {
		getSelectedCollections() {
			throw new Error("no selection");
		},
		getSelectedLibraryIDs: () => [4],
	};
	assert.deepEqual(pick(resolveImportTarget(fakeZoteroWithPane(throwing))), { collection: null, libraryID: 4, source: "none" });

	const libraryRow = { isCollection: () => false, ref: { libraryID: 5 } };
	assert.deepEqual(pick(resolveImportTarget(fakeZoteroWithPane({ collectionsView: { selectedTreeRow: libraryRow } }))),
		{ collection: null, libraryID: 5, source: "none" });

	assert.deepEqual(pick(resolveImportTarget({ getMainWindow: () => null, Libraries: { userLibraryID: 1 } })),
		{ collection: null, libraryID: 1, source: "none" });

	// The context menu of a library row, whose collectionTreeRow getter throws.
	const context = { get collectionTreeRow() {
		throw new Error("not a collection");
	} };
	assert.deepEqual(pick(resolveImportTarget(fakeZoteroWithPane({}), context)), { collection: null, libraryID: 1, source: "none" });
});
