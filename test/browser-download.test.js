/**
 * Downloads made in the user's browser: links, matching downloaded files to
 * papers, and the waiting for them in the Downloads folder.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { BROWSER_DOWNLOAD } from "../src/config.js";
import { browserPdfURL, paperForFileName } from "../src/core/downloads.js";
import { BrowserDownloads } from "../src/zotero/browser-download.js";
import { createFakeZotero } from "./fake-zotero.js";

const acm = { doi: "10.1145/3576915.3623096", title: "Threshold Signatures from Inner Product Argument: Succinct, Weighted, and Multi-threshold" };
const ieee = { doi: "10.1109/SP46215.2023.10179388", title: "Practical Asynchronous Distributed Key Generation" };
const springer = { doi: "10.1007/978-3-031-38554-4_5", title: "Short Signatures from Regular Syndrome Decoding" };

test("ACM papers open straight at the PDF; others at the DOI's landing page", () => {
	assert.equal(browserPdfURL(acm.doi), "https://dl.acm.org/doi/pdf/10.1145/3576915.3623096");
	assert.equal(browserPdfURL(springer.doi), "https://doi.org/10.1007/978-3-031-38554-4_5");
});

test("a downloaded file is matched to its paper by the DOI or the title in its name", () => {
	const papers = [acm, ieee, springer];
	assert.equal(paperForFileName("3576915.3623096.pdf", papers), acm, "ACM names PDFs after the DOI");
	assert.equal(paperForFileName("978-3-031-38554-4_5.pdf", papers), springer);
	assert.equal(paperForFileName("Practical_Asynchronous_Distributed_Key_Generation.pdf", papers), ieee);
	assert.equal(paperForFileName("Threshold Signatures from Inner Product Argument_ Succi.pdf", papers), acm, "a title cut short");
	assert.equal(paperForFileName("fulltext.pdf", papers), null);
	assert.equal(paperForFileName("download (3).pdf", papers), null);
	assert.equal(paperForFileName("Practical.pdf", papers), null, "too little of a title");
});

/** A Downloads folder in memory; `save(name)` is the browser saving a file. */
function fakeFolder() {
	const files = new Map();
	return {
		files: {
			children: async () => [...files.keys()],
			stat: async (path) => ({ type: "regular", size: files.get(path) }),
			basename: (path) => path.split("/").pop(),
		},
		save: (name, size = 1000) => files.set(`/Downloads/${name}`, size),
	};
}

/**
 * The watcher, with time that passes only at each look at the folder;
 * `browser(url, look)` plays the user: it is called for every opened link and
 * before every look.
 */
function setup({ onLook = () => {} } = {}) {
	const Zotero = createFakeZotero();
	const folder = fakeFolder();
	const opened = [];
	let clock = 0;
	let looks = 0;
	const watcher = new BrowserDownloads({
		Zotero,
		files: folder.files,
		timers: { setTimeout: (fn, ms) => { clock += ms; onLook(++looks, { folder, opened }); fn(); } },
		openURL: (url) => opened.push(url),
		log: () => {},
		now: () => clock,
	});
	const paper = (data) => ({ ...data, item: Zotero.addItem("conferencePaper", { fields: { title: data.title, DOI: data.doi } }) });
	return { Zotero, folder, opened, watcher, paper };
}

test("PDFs saved in the browser are attached to their papers, and further links open as earlier ones arrive", async () => {
	const papers = [];
	const env = setup({
		onLook: (look, { folder }) => {
			// The user saves the ACM paper first, then the others in reverse order.
			if (look === 1) folder.save("3576915.3623096.pdf");
			if (look === 3) folder.save("Short_Signatures_from_Regular_Syndrome_Decoding.pdf");
			if (look === 5) folder.save("download.pdf");
		},
	});
	env.folder.save("old-paper.pdf");
	papers.push(env.paper(acm), env.paper(springer), env.paper(ieee));
	const attached = [];
	const outcome = await env.watcher.run(papers, "/Downloads", { onAttached: (paper, name) => attached.push([paper.doi, name]) });

	assert.deepEqual(env.opened, papers.map((p) => browserPdfURL(p.doi)), "all links opened (at most BROWSER_DOWNLOAD.maxOpen at once)");
	assert.deepEqual(attached, [
		[acm.doi, "3576915.3623096.pdf"],
		[springer.doi, "Short_Signatures_from_Regular_Syndrome_Decoding.pdf"],
		[ieee.doi, "download.pdf"],
	], "a name that says nothing goes to the only paper still open");
	assert.deepEqual(outcome.missing, []);
	assert.equal(papers[0].item.attachments.length, 1);
	assert.equal(papers[0].item.attachments[0].path, "/Downloads/3576915.3623096.pdf");
	assert.ok(!papers.some((p) => p.item.attachments.some((a) => a.path.endsWith("old-paper.pdf"))), "files there before are left alone");
});

test("only BROWSER_DOWNLOAD.maxOpen links are open at once; a file naming no paper is reported while several are open", async () => {
	const unmatched = [];
	let stop = false;
	const env = setup({
		onLook: (look, { folder }) => {
			if (look === 1) folder.save("download.pdf");
			if (look === 4) stop = true;
		},
	});
	const papers = Array.from({ length: BROWSER_DOWNLOAD.maxOpen + 2 }, (_, i) => env.paper({ doi: `10.1145/${1000000 + i}.${2000000 + i}`, title: `Paper number ${i}` }));
	const outcome = await env.watcher.run(papers, "/Downloads", { onUnmatched: (name) => unmatched.push(name), shouldStop: () => stop });
	assert.equal(env.opened.length, BROWSER_DOWNLOAD.maxOpen);
	assert.deepEqual(unmatched, ["download.pdf"]);
	assert.equal(outcome.missing.length, papers.length, "Stop leaves every paper missing");
});

test("a file still growing is attached only once its size has settled; waiting ends after a quiet spell", async () => {
	let current = 0;
	const env = setup({
		onLook: (look, { folder }) => {
			current = look;
			if (look === 1) folder.save("3576915.3623096.pdf", 10);
			if (look === 2) folder.save("3576915.3623096.pdf", 500);
		},
	});
	const papers = [env.paper(acm), env.paper(springer)];
	const attachedAt = [];
	const outcome = await env.watcher.run(papers, "/Downloads", { onAttached: () => attachedAt.push(current) });
	assert.deepEqual(attachedAt, [3], "seen growing at the first two looks, settled at the third");
	assert.equal(current, 3 + BROWSER_DOWNLOAD.idleTimeoutMs / BROWSER_DOWNLOAD.pollMs, "then it waited a quiet spell");
	assert.deepEqual(outcome.missing.map((p) => p.doi), [springer.doi], "nothing more came");
});

test("the PDF is named as Zotero names files, when Zotero renames them", async () => {
	const env = setup({ onLook: (look, { folder }) => look === 1 && folder.save("3576915.3623096.pdf") });
	Object.assign(env.Zotero.Attachments, {
		shouldAutoRenameFile: () => true,
		isRenameAllowedForType: (type) => type === "application/pdf",
		getFileBaseNameFromItem: (item) => `Author - 2023 - ${item.getField("title").slice(0, 20)}`,
	});
	const paper = env.paper(acm);
	await env.watcher.run([paper], "/Downloads");
	assert.equal(paper.item.attachments[0].path, "/Downloads/Author - 2023 - Threshold Signatures.pdf");
});
