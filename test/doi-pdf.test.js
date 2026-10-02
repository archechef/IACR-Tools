/**
 * PDFs of papers without an ePrint version, fetched through the DOI with
 * Zotero's Find Full Text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { DOI_PDF } from "../src/config.js";
import { DoiPdfAction } from "../src/zotero/doi-pdf.js";
import { Pipeline } from "../src/zotero/pipeline.js";
import { createFakeZotero } from "./fake-zotero.js";

/** A pipeline over the action; `eprintIds` maps titles to the ePrint ids the lookup would find. */
function setup({ findFile = () => null, eprintIds = {}, fetch } = {}) {
	const Zotero = createFakeZotero({ findFile });
	if (fetch) Zotero.Attachments.addAvailableFile = fetch;
	let clock = 0;
	const waits = [];
	const timers = {
		setTimeout: (fn, ms) => {
			waits.push(ms);
			clock += ms;
			fn();
		},
	};
	const viaDoi = new DoiPdfAction({
		Zotero,
		eprintIdOf: async (context) => eprintIds[context.item.getField("title")] ?? null,
		timers,
		now: () => clock,
	});
	const pipeline = new Pipeline({ Zotero, store: null, log: () => {} });
	const run = async (items, concurrency = 1) => {
		const summary = await pipeline.run(items, [viaDoi.action], { concurrency });
		return summary.map(({ results }) => results[0]);
	};
	return { Zotero, run, waits, tick: (ms) => (clock += ms) };
}

const paper = (Zotero, title, fields = {}) => Zotero.addItem("conferencePaper", { fields: { title, ...fields } });

test("a paper with a DOI and no ePrint version gets its PDF through Zotero's Find Full Text", async () => {
	const { Zotero, run } = setup({
		findFile: (item) => (item.getField("DOI") ? { url: "https://link.springer.com/content/pdf/10.1007/x.pdf" } : null),
	});
	const item = paper(Zotero, "Published Only", { DOI: "10.1007/978-3-031-00000-0_1" });
	const [outcome] = await run([item]);
	assert.equal(outcome.status, "changed");
	assert.equal(outcome.detail, "Full Text PDF from link.springer.com");
	assert.equal(item.attachments.length, 1);
	assert.deepEqual(Zotero.Attachments.fileRequests, [{ itemID: item.id, options: { methods: [...DOI_PDF.methods] } }],
		"the DOI, open-access and custom resolvers; not the item's URL");
});

test("papers with an ePrint version, without a DOI or with a PDF are left alone", async () => {
	const { Zotero, run } = setup({ findFile: () => ({ url: "https://example.org/x.pdf" }), eprintIds: { "Has ePrint": "2008/045" } });
	const withEprint = paper(Zotero, "Has ePrint", { DOI: "10.1007/1" });
	const withoutDoi = paper(Zotero, "No DOI");
	const withPdf = paper(Zotero, "Has PDF", { DOI: "10.1007/2" });
	Zotero.addPDF({ path: "/storage/has-pdf.pdf", parentItemID: withPdf.id });

	const outcomes = await run([withEprint, withoutDoi, withPdf]);
	assert.deepEqual(outcomes.map((o) => o.status), ["skipped", "skipped", "unchanged"]);
	assert.match(outcomes[0].detail, /2008\/045/);
	assert.equal(Zotero.Attachments.fileRequests.length, 0, "Find Full Text was never asked");
});

test("nothing found is reported, not a failure; an error is a failure", async () => {
	const nothing = setup();
	const [none] = await nothing.run([paper(nothing.Zotero, "Paywalled", { DOI: "10.1145/1" })]);
	assert.equal(none.status, "unchanged");
	assert.equal(none.detail, "no PDF found via the DOI");

	const broken = setup({ fetch: async () => { throw new Error("CAPTCHA required"); } });
	const [failed] = await broken.run([paper(broken.Zotero, "Blocked", { DOI: "10.1145/2" })]);
	assert.equal(failed.status, "failed");
	assert.match(failed.detail, /CAPTCHA/);
});

test("fetches run one at a time, a second apart, even when papers run in parallel", async () => {
	let running = 0;
	let most = 0;
	const env = setup({
		fetch: async (item) => {
			most = Math.max(most, ++running);
			await new Promise((resolve) => setImmediate(resolve));
			running--;
			env.tick(200);
			return false;
		},
	});
	const items = ["A", "B", "C"].map((title, i) => paper(env.Zotero, title, { DOI: `10.1007/${i}` }));
	await env.run(items, 3);
	assert.equal(most, 1, "never two publisher requests at once");
	assert.deepEqual(env.waits, [DOI_PDF.requestSpacingMs, DOI_PDF.requestSpacingMs], "each starts a full second after the previous one ended");
});
