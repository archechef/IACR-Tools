import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";

import { CRYPTOBIB, PREFS } from "../src/config.js";
import { AutoProcessor } from "../src/zotero/auto-processor.js";
import { CryptoBibStore } from "../src/zotero/cryptobib-store.js";
import { createCryptoBibSyncAction } from "../src/zotero/cryptobib-sync.js";
import { EprintActions, storedEprintId } from "../src/zotero/eprint.js";
import { cryptoBibSource, dblpSource, EprintFinder, iacrSearchSource } from "../src/zotero/eprint-sources.js";
import { ItemWrapper } from "../src/zotero/item.js";
import { Pipeline } from "../src/zotero/pipeline.js";
import { Prefs } from "../src/zotero/prefs.js";
import { convertSpringerAction } from "../src/zotero/springer.js";
import { COMMANDS } from "../src/plugin.js";
import { L10n } from "../src/ui/l10n.js";
import { createFakeZotero } from "./fake-zotero.js";

const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

/** Serves the CryptoBib fixtures (abbrev0 for every level) and canned JSON / documents. */
function createFakeHttp({ json = {}, documents = {} } = {}) {
	const requests = [];
	return {
		requests,
		async getText(url) {
			requests.push(url);
			if (url.endsWith(CRYPTOBIB.mainFile)) return fixture("crypto.bib");
			if (/abbrev\d\.bib$/.test(url)) return fixture("abbrev0.bib");
			throw new Error(`404 ${url}`);
		},
		async getJSON(url) {
			requests.push(url);
			const key = Object.keys(json).find((k) => url.includes(k));
			if (!key) throw new Error(`404 ${url}`);
			return json[key];
		},
		async getDocument(url) {
			requests.push(url);
			const key = Object.keys(documents).find((k) => url.includes(k));
			if (!key) throw new Error(`404 ${url}`);
			return documents[key];
		},
	};
}

const nodeFiles = {
	join,
	async exists(path) {
		return access(path).then(() => true, () => false);
	},
	readText: (path) => readFile(path, "utf8"),
	writeText: (path, text) => writeFile(path, text),
	makeDirectory: (path) => mkdir(path, { recursive: true }).then(() => {}),
};

/** Timers that never fire on their own; `flush()` runs what is pending. */
function createManualTimers() {
	let next = 1;
	const pending = new Map();
	return {
		setTimeout: (fn) => {
			pending.set(next, fn);
			return next++;
		},
		clearTimeout: (id) => pending.delete(id),
		async flush() {
			const callbacks = [...pending.values()];
			pending.clear();
			for (const fn of callbacks) await fn();
		},
	};
}

let env;

function setup({ http = createFakeHttp(), prefs: prefValues = {} } = {}) {
	const Zotero = createFakeZotero();
	const prefs = new Prefs({ Zotero, Services: null });
	for (const [name, value] of Object.entries(prefValues)) prefs.set(name, value);
	const dataDirectory = mkdtempSync(join(tmpdir(), "iacr-tools-"));
	const timers = createManualTimers();
	const log = (msg) => Zotero.logs.push(msg);
	const store = new CryptoBibStore({ http, files: nodeFiles, prefs, dataDirectory, timers, log });
	const finder = new EprintFinder(() => [
		cryptoBibSource(store),
		...(prefs.get("useOnlineEprintSearch") ? [dblpSource(http), iacrSearchSource(http)] : []),
	], log);
	const eprint = new EprintActions({ Zotero, prefs, finder });
	const pipeline = new Pipeline({ Zotero, store, log });
	return {
		Zotero, prefs, http, store, timers, dataDirectory, pipeline, eprint, log,
		sync: createCryptoBibSyncAction(prefs),
	};
}

beforeEach(() => {
	env = setup();
});

afterEach(() => {
	env.store.dispose();
	rmSync(env.dataDirectory, { recursive: true, force: true });
});

/** A Springer LNCS chapter as saved by the Springer Link translator. */
function springerChapter(Zotero, overrides = {}) {
	return Zotero.addItem("bookSection", {
		fields: {
			title: "Proving Tight Security for Rabin-Williams Signatures",
			bookTitle: "Advances in Cryptology – EUROCRYPT 2008",
			series: "Lecture Notes in Computer Science",
			publisher: "Springer",
			place: "Berlin, Heidelberg",
			date: "2008",
			pages: "70-87",
			extra: "DOI: 10.1007/978-3-540-78967-3_5",
			...overrides,
		},
		creators: [
			{ firstName: "Daniel J.", lastName: "Bernstein", creatorType: "author" },
			{ firstName: "Nigel", lastName: "Smart", creatorType: "editor" },
		],
	});
}

test("Springer chapters become conference papers, keeping the book title and moving the DOI", async () => {
	const item = springerChapter(env.Zotero);
	const [{ results }] = await env.pipeline.run([item], [convertSpringerAction]);
	assert.equal(results[0].status, "changed");
	assert.equal(item.itemType, "conferencePaper");
	assert.equal(item.getField("proceedingsTitle"), "Advances in Cryptology – EUROCRYPT 2008");
	assert.equal(item.getField("DOI"), "10.1007/978-3-540-78967-3_5");
	assert.equal(item.getField("extra"), "");
	assert.equal(item.saveCount, 1);
});

test("Springer chapters unknown to CryptoBib are converted based on their series", async () => {
	const lncs = springerChapter(env.Zotero, { title: "A Paper That CryptoBib Does Not Know About", extra: "DOI: 10.1007/978-3-031-00000-0_1" });
	const book = springerChapter(env.Zotero, {
		title: "A Chapter of an Ordinary Monograph Volume",
		bookTitle: "Handbook of Something",
		series: "Studies in Computational Intelligence",
		extra: "DOI: 10.1007/978-3-031-00000-1_2",
	});
	const other = springerChapter(env.Zotero, { extra: "DOI: 10.1145/1234.5678" });
	const summary = await env.pipeline.run([lncs, book, other], [convertSpringerAction]);
	assert.deepEqual(summary.map((s) => s.results[0].status), ["changed", "unchanged", "skipped"]);
	assert.deepEqual([lncs, book, other].map((i) => i.itemType), ["conferencePaper", "bookSection", "bookSection"]);
});

test("CryptoBib metadata replaces the imported metadata", async () => {
	const item = springerChapter(env.Zotero);
	const [{ results }] = await env.pipeline.run([item], [convertSpringerAction, env.sync]);
	assert.deepEqual(results.map((r) => r.status), ["changed", "changed"]);
	assert.equal(results[1].detail, "EC:Bernstein08");
	const expected = {
		title: "Proving Tight Security for Rabin-Williams Signatures",
		proceedingsTitle: "Advances in Cryptology – EUROCRYPT 2008",
		conferenceName: "EUROCRYPT 2008",
		volume: "4965",
		pages: "70-87",
		series: "Lecture Notes in Computer Science",
		publisher: "Springer Berlin Heidelberg, Germany",
		eventPlace: "Istanbul, Turkey",
		place: "Berlin, Heidelberg",
		date: "2008-04",
		DOI: "10.1007/978-3-540-78967-3_5",
		citationKey: "EC:Bernstein08",
	};
	for (const [field, value] of Object.entries(expected)) assert.equal(item.getField(field), value, field);
	assert.deepEqual(item.getCreatorsJSON(), [
		{ firstName: "Daniel J.", lastName: "Bernstein", creatorType: "author" },
		{ firstName: "Nigel P.", lastName: "Smart", creatorType: "editor" },
	]);

	// A second run finds nothing left to change.
	const [{ results: again }] = await env.pipeline.run([item], [env.sync]);
	assert.equal(again[0].status, "unchanged");
});

test("CryptoBib sync converts book sections itself and respects the overwrite preference", async () => {
	env.prefs.set("overwriteFields", false);
	const item = springerChapter(env.Zotero, { pages: "1-2" });
	await env.pipeline.run([item], [env.sync]);
	assert.equal(item.itemType, "conferencePaper");
	assert.equal(item.getField("pages"), "1-2", "existing value kept");
	assert.equal(item.getField("conferenceName"), "EUROCRYPT 2008", "empty field filled");
});

test("preprints are never overwritten with the published version", async () => {
	const preprint = env.Zotero.addItem("preprint", { fields: { title: "Proving Tight Security for Rabin-Williams Signatures" } });
	const [{ results }] = await env.pipeline.run([preprint], [env.sync]);
	assert.equal(results[0].status, "skipped");
});

test("the ePrint version is found, stored in Extra and downloaded once", async () => {
	const item = env.Zotero.addItem("conferencePaper", {
		fields: { title: "Threshold RSA for Dynamic and Ad-Hoc Groups", date: "2008", DOI: "10.1007/978-3-540-78967-3_6", extra: "tex.note: keep me" },
		creators: [{ firstName: "Rosario", lastName: "Gennaro", creatorType: "author" }],
	});
	const [{ results }] = await env.pipeline.run([item], [env.eprint.download]);
	assert.equal(results[0].status, "changed");
	assert.equal(item.getField("extra"), "tex.note: keep me\nIACR ePrint: 2008/045");
	assert.equal(storedEprintId(new ItemWrapper(item, env.Zotero), PREFS.eprintExtraKey.default), "2008/045");
	assert.deepEqual(item.attachments.map((a) => [a.url, a.contentType]), [["https://eprint.iacr.org/2008/045.pdf", "application/pdf"]]);

	const [{ results: again }] = await env.pipeline.run([item], [env.eprint.download]);
	assert.equal(again[0].status, "unchanged");
	assert.equal(item.attachments.length, 1);
});

test("online sources are used when CryptoBib has no ePrint entry", async () => {
	const http = createFakeHttp({
		json: {
			"dblp.org": {
				result: {
					hits: {
						hit: [
							{ info: { title: "Some Other Paper.", venue: "IACR Cryptol. ePrint Arch.", year: "2020", volume: "2020", pages: "1", authors: { author: { text: "Ada Lovelace" } } } },
							{ info: { title: "Lattice Signatures Made Practical Again.", venue: "IACR Cryptol. ePrint Arch.", year: "2021", volume: "2021", pages: "77", ee: "https://eprint.iacr.org/2021/077", authors: { author: [{ text: "Ada Lovelace 0001" }, { text: "Alan Turing" }] } } },
							{ info: { title: "Lattice Signatures Made Practical Again.", venue: "CRYPTO", year: "2022", authors: { author: [{ text: "Ada Lovelace" }] } } },
						],
					},
				},
			},
		},
	});
	env.store.dispose();
	env = setup({ http });
	const item = env.Zotero.addItem("conferencePaper", {
		fields: { title: "Lattice signatures made practical again", date: "2022" },
		creators: [{ firstName: "Ada", lastName: "Lovelace", creatorType: "author" }],
	});
	const [{ results }] = await env.pipeline.run([item], [env.eprint.find]);
	assert.equal(results[0].status, "changed");
	assert.match(results[0].detail, /2021\/077 \(dblp\)/);

	env.prefs.set("useOnlineEprintSearch", false);
	const other = env.Zotero.addItem("conferencePaper", { fields: { title: "Lattice signatures made practical again" } });
	const [{ results: offline }] = await env.pipeline.run([other], [env.eprint.find]);
	assert.equal(offline[0].status, "unchanged");
});

test("the eprint.iacr.org search is the last resort and needs a near-identical title", async () => {
	const row = (href, title) => ({
		querySelector: (selector) => (selector.includes("paperlink")
			? { getAttribute: () => href }
			: { textContent: title }),
	});
	const documents = {
		"eprint.iacr.org/search": {
			querySelectorAll: () => [row("/2019/1234", "Unrelated Work on Hash Functions"), row("/2023/042", "Proofs of Things, Revisited")],
		},
	};
	env.store.dispose();
	env = setup({ http: createFakeHttp({ documents }) });
	const item = env.Zotero.addItem("journalArticle", { fields: { title: "Proofs of things revisited" } });
	const [{ results }] = await env.pipeline.run([item], [env.eprint.find]);
	assert.match(results[0].detail, /^2023\/042 \(IACR ePrint search\)$/);
});

test("preprint items saved from eprint.iacr.org get their id recorded without a lookup", async () => {
	const item = env.Zotero.addItem("preprint", { fields: { title: "X", url: "https://eprint.iacr.org/2024/5" } });
	const [{ results }] = await env.pipeline.run([item], [env.eprint.find]);
	assert.equal(results[0].detail, "2024/005");
	assert.equal(env.http.requests.length, 0);
});

test("menu commands download several ePrint PDFs at once, one task per item", async () => {
	const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	let inFlight = 0;
	let maxInFlight = 0;
	const { Attachments } = env.Zotero;
	const importFromURL = Attachments.importFromURL.bind(Attachments);
	Attachments.importFromURL = async (options) => {
		maxInFlight = Math.max(maxInFlight, ++inFlight);
		await delay(10);
		inFlight--;
		return importFromURL(options);
	};
	const items = Array.from({ length: 10 }, (_, i) =>
		env.Zotero.addItem("preprint", { fields: { title: `Paper ${i}`, url: `https://eprint.iacr.org/2024/${100 + i}` } }));

	const summary = await env.pipeline.run([...items, items[0]], [env.eprint.download], { concurrency: 4 });
	assert.deepEqual(summary.map(({ item }) => item), items, "each item once, in input order");
	assert.equal(maxInFlight, 4);
	for (const item of items) assert.equal(item.attachments.length, 1);
});

test("new items are processed automatically, synced ones are left alone", async () => {
	const auto = new AutoProcessor({
		Zotero: env.Zotero,
		pipeline: env.pipeline,
		enabledActions: () => [convertSpringerAction, env.sync],
		timers: env.timers,
		log: env.log,
	});
	auto.start();
	const fresh = springerChapter(env.Zotero);
	const synced = env.Zotero.addItem("bookSection", { fields: { title: "Proving Tight Security for Rabin-Williams Signatures", extra: "DOI: 10.1007/978-3-540-78967-3_5" }, synced: true });
	env.Zotero.Notifier.trigger("modify", "item", [fresh.id]);
	env.Zotero.Notifier.trigger("add", "item", [fresh.id, synced.id]);
	await env.timers.flush();
	await auto.whenIdle();
	assert.equal(fresh.itemType, "conferencePaper");
	assert.equal(fresh.getField("citationKey"), "EC:Bernstein08");
	assert.equal(synced.itemType, "bookSection");
	auto.stop();
});

test("the store downloads once, caches parsed records and refreshes stale data in the background", async () => {
	const index = await env.store.getIndex();
	assert.equal(index.size, 6);
	const downloads = env.http.requests.length;
	assert.equal(downloads, 1 + CRYPTOBIB.abbrevLevels.length);

	// A second store over the same directory reuses the cache without network access.
	let now = Date.now();
	const http = createFakeHttp();
	const store = new CryptoBibStore({ http, files: nodeFiles, prefs: env.prefs, dataDirectory: env.dataDirectory, timers: env.timers, log: env.log, now: () => now });
	assert.equal((await store.getIndex()).size, 6);
	assert.equal(http.requests.length, 0);

	// Once stale, the cached index is still served while a refresh runs.
	now += (PREFS.cryptobibMaxAgeDays.default + 1) * 24 * 3600 * 1000;
	store.invalidate();
	assert.equal((await store.getIndex()).size, 6);
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));
	assert.ok(http.requests.length > 0, "refresh started");
	store.dispose();
});

test("a download that is not CryptoBib, or lost most of its entries, never replaces the good copy", async () => {
	assert.equal((await env.store.getIndex()).size, 6);
	const serve = (main, abbrev = fixture("abbrev0.bib")) => ({
		...createFakeHttp(),
		async getText(url) {
			return url.endsWith(CRYPTOBIB.mainFile) ? main : abbrev;
		},
	});
	const storeWith = (http) => new CryptoBibStore({ http, files: nodeFiles, prefs: env.prefs, dataDirectory: env.dataDirectory, timers: env.timers, log: env.log });

	const errorPage = storeWith(serve("<!DOCTYPE html><html><body>Rate limit exceeded</body></html>"));
	await assert.rejects(errorPage.update(), /no BibTeX entries/);
	const noMacros = storeWith(serve(fixture("crypto.bib"), "404: Not Found"));
	await assert.rejects(noMacros.update(), /no @string definitions/);
	const firstEntry = fixture("crypto.bib").search(/^@(?!string)/im);
	const truncated = storeWith(serve(fixture("crypto.bib").slice(0, fixture("crypto.bib").indexOf("\n@", firstEntry + 1))));
	await assert.rejects(truncated.update(), /only 1 entries \(previously 6\)/);

	// The cache on disk is untouched: a fresh store still sees all six entries.
	const meta = JSON.parse(await readFile(join(env.dataDirectory, "iacr-tools", CRYPTOBIB.metaFile), "utf8"));
	assert.equal(meta.entries, 6);
	assert.equal((await storeWith(createFakeHttp()).getIndex()).size, 6);
	for (const store of [errorPage, noMacros, truncated]) store.dispose();
});

test("every Fluent id used by the plugin exists in the locale file", () => {
	const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
	const defined = new Set([...read("addon/locale/en-US/iacr-tools.ftl").matchAll(/^([a-z0-9-]+) =/gm)].map((m) => m[1]));
	const sources = ["src/plugin.js", "src/ui/menus.js", "src/ui/progress.js", "src/ui/duplicates.js", "addon/content/duplicates.js"]
		.map(read).join("\n");
	const literal = [...sources.matchAll(/(?:format|status|finish|L10n\.id|\bt)\("([a-z0-9-]+)"/g)].map((m) => m[1]);
	const dynamic = [
		...COMMANDS.flatMap(({ id }) => [`menu-${id}`, `progress-${id}`]),
		...["changed", "unchanged", "skipped", "failed"].map((s) => `status-${s}`),
		...["downloading", "indexing", "ready"].map((s) => `store-${s}`),
	];
	const prefPane = [...read("addon/content/preferences.xhtml").matchAll(/__L10N_PREFIX__-([a-z0-9-]+)/g)]
		.map((m) => m[1]).filter((id) => !id.endsWith("prefs") && id !== "update-cryptobib");
	for (const id of [...literal, ...dynamic, ...prefPane]) {
		assert.ok(defined.has(L10n.id(id)), `missing Fluent message ${L10n.id(id)}`);
	}
});
