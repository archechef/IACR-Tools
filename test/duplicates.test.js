/**
 * Duplicate papers across versions: grouping, merging copies, linking
 * versions, remembering groups that are not the same paper, and the report.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { findDuplicateGroups } from "../src/core/duplicates.js";
import { DuplicatesView } from "../src/ui/duplicates.js";
import { DuplicateFinder } from "../src/zotero/duplicates.js";
import { Prefs } from "../src/zotero/prefs.js";
import { createFakeZotero } from "./fake-zotero.js";

const paper = (id, itemType, title, authors, extra = {}) => ({ id, itemType, title, authors, ...extra });

test("copies and versions of a paper are grouped; unrelated papers are not", () => {
	const groups = findDuplicateGroups([
		paper(1, "conferencePaper", "Threshold RSA for Dynamic and Ad-Hoc Groups", ["Gennaro", "Rabin"], { year: 2008, doi: "10.1007/978-3-540-78967-3_6" }),
		paper(2, "preprint", "Threshold RSA for dynamic and ad hoc groups", ["Gennaro", "Halevi"], { year: 2007, eprintId: "2008/045" }),
		paper(3, "conferencePaper", "Threshold RSA for Dynamic and Ad-Hoc Groups.", ["Gennaro"], { year: 2008 }),
		paper(4, "bookSection", "Threshold RSA (EC 2008)", [], { doi: "https://doi.org/10.1007/978-3-540-78967-3_6" }),
		paper(5, "journalArticle", "Threshold RSA for Dynamic and Ad-Hoc Groups", ["Gennaro", "Krawczyk"], { year: 2012, doi: "10.1007/s00145-012-0001-0" }),
		paper(6, "conferencePaper", "Verifiable Decryption in the Head", ["Gjøsteen"], { year: 2022 }),
		paper(7, "conferencePaper", "Short E-Cash", ["Camenisch"]),
		paper(8, "conferencePaper", "Short E-Cash", ["Okamoto"]),
	]);
	assert.equal(groups.length, 1, "short titles with different authors are not the same paper");
	const clusters = groups[0].clusters.map((cluster) => cluster.map((p) => p.id));
	// The conference paper, its copy without DOI and the Springer chapter with the
	// same DOI are copies; the preprint and the journal version are versions.
	assert.deepEqual(clusters, [[1, 3, 4], [2], [5]]);
});

test("papers of the same type with different DOIs are different publications", () => {
	const groups = findDuplicateGroups([
		paper(1, "journalArticle", "On the Security of Something", ["Smith"], { doi: "10.1000/a" }),
		paper(2, "journalArticle", "On the Security of Something", ["Smith"], { doi: "10.1000/b" }),
	]);
	assert.equal(groups.length, 0);
});

/** A library with a paper in three versions and two copies, and Zotero's merge. */
function library() {
	const Zotero = createFakeZotero();
	const prefs = new Prefs({ Zotero, Services: null });
	const merged = [];
	const mergeItems = async (master, others) => {
		merged.push({ master, others });
		for (const other of others) {
			master.attachments.push(...other.attachments);
			other.attachments = [];
			for (const id of other.collections) master.addToCollection(id);
			for (const key of other.related) master.related.add(key);
			other.deleted = true;
		}
	};
	const authors = (...names) => names.map((lastName) => ({ firstName: "", lastName, creatorType: "author" }));
	const conference = Zotero.addItem("conferencePaper", {
		fields: { title: "Threshold RSA for Dynamic and Ad-Hoc Groups", DOI: "10.1007/978-3-540-78967-3_6", date: "2008", citationKey: "EC:GHKR08" },
		creators: authors("Gennaro", "Halevi"),
	});
	const copy = Zotero.addItem("bookSection", {
		fields: { title: "Threshold RSA for Dynamic and Ad-Hoc Groups", date: "2008", extra: "DOI: 10.1007/978-3-540-78967-3_6" },
		creators: authors("Gennaro"),
	});
	copy.addToCollection(42);
	copy.attachments.push({ id: 999 });
	const preprint = Zotero.addItem("preprint", {
		fields: { title: "Threshold RSA for Dynamic and Ad-Hoc Groups", archiveID: "2008/045", date: "2007" },
		creators: authors("Gennaro", "Krawczyk"),
	});
	const unrelated = Zotero.addItem("conferencePaper", { fields: { title: "Verifiable Decryption in the Head" }, creators: authors("Gjøsteen") });
	const finder = new DuplicateFinder({ Zotero, prefs, mergeItems });
	return { Zotero, prefs, finder, merged, conference, copy, preprint, unrelated };
}

test("the report groups a library's copies and versions, keeping the CryptoBib-keyed copy first", async () => {
	const { finder, conference, copy, preprint } = library();
	const report = await finder.find(1);
	assert.equal(report.papers, 4);
	assert.equal(report.groups.length, 1);
	const [group] = report.groups;
	assert.deepEqual(group.clusters.map((cluster) => cluster.map((p) => p.item)), [[conference, copy], [preprint]]);
	assert.equal(group.clusters[1][0].eprintId, "2008/045");
	assert.equal(group.id, [conference.key, copy.key, preprint.key].sort().join(" "));
});

test("merging converts copies to the kept item's type and hands them to Zotero's merge", async () => {
	const { finder, merged, conference, copy } = library();
	const [group] = (await finder.find(1)).groups;
	const kept = await finder.merge(group.clusters[0], conference.id);
	assert.equal(kept, conference);
	assert.equal(merged.length, 1);
	assert.deepEqual(merged[0].others, [copy]);
	assert.equal(copy.itemType, "conferencePaper", "converted before the merge");
	assert.equal(copy.deleted, true);
	assert.ok(conference.inCollection(42), "the copy's collections move to the kept item");
	assert.equal(conference.attachments.length, 1, "and its attachments");
	await assert.rejects(finder.merge(group.clusters[0], 123456), /no longer in the library/);
});

test("linking relates every version with the others; linked versions are still reported, flagged as linked", async () => {
	const { Zotero, finder, conference, copy, preprint } = library();
	let [group] = (await finder.find(1)).groups;
	assert.equal(group.linked, false);
	await finder.merge(group.clusters[0], conference.id);
	[group] = (await finder.find(1)).groups;
	assert.deepEqual(group.clusters.map((cluster) => cluster.map((p) => p.item)), [[conference], [preprint]]);
	assert.equal(await finder.link(group), 1);
	assert.ok(conference.relatedItems.includes(preprint.key) && preprint.relatedItems.includes(conference.key));
	const [linked] = (await finder.find(1)).groups;
	assert.equal(linked.linked, true, "still reported: it can be merged");
	assert.equal(copy.deleted, true);

	// A new copy makes it a new group, with a copy that is not linked.
	Zotero.addItem("conferencePaper", {
		fields: { title: "Threshold RSA for Dynamic and Ad-Hoc Groups", date: "2008" },
		creators: [{ firstName: "", lastName: "Gennaro", creatorType: "author" }],
	});
	const [grown] = (await finder.find(1)).groups;
	assert.notEqual(grown.id, linked.id);
	assert.equal(grown.linked, false);
});

/**
 * The case reported from a real library: the CRYPTO 2016 paper (with its ePrint
 * id in Extra) and its ePrint preprint (saved from eprint.iacr.org), linked as
 * related items and both in the same collection.
 */
function kmp16() {
	const env = library();
	const { Zotero } = env;
	const authors = ["Kiltz", "Masny", "Pan"].map((lastName) => ({ firstName: "", lastName, creatorType: "author" }));
	const title = "Optimal Security Proofs for Signatures from Identification Schemes";
	const published = Zotero.addItem("conferencePaper", {
		fields: { title, DOI: "10.1007/978-3-662-53008-5_2", date: "2016", proceedingsTitle: "Advances in Cryptology – CRYPTO 2016", extra: "IACR ePrint: 2016/191" },
		creators: authors,
	});
	const eprint = Zotero.addItem("preprint", {
		fields: { title, archiveID: "2016/191", url: "https://eprint.iacr.org/2016/191", date: "2016", extra: "Publication info: Preprint. MINOR revision." },
		creators: authors,
	});
	for (const item of [published, eprint]) item.addToCollection(7);
	published.addRelatedItem(eprint);
	eprint.addRelatedItem(published);
	eprint.attachments.push({ id: 335 });
	eprint.tags.push("Fiat-Shamir");
	return { ...env, published, eprint };
}

test("a linked ePrint preprint is reported and can be merged into its published version", async () => {
	const { finder, merged, published, eprint } = kmp16();
	const group = (await finder.find(1, { scope: new Set([published.id]) })).groups[0];
	assert.ok(group, "the pair is reported although it is linked");
	assert.equal(group.linked, true);
	assert.deepEqual(group.clusters.map((cluster) => cluster.map((p) => p.item)), [[published], [eprint]]);
	assert.deepEqual(finder.mergeTargets(group).map((p) => p.item), [published]);

	const kept = await finder.mergeVersions(group, published.id);
	assert.equal(kept, published);
	assert.deepEqual(merged.at(-1).others, [eprint], "Zotero's merge, with the preprint");
	assert.equal(eprint.itemType, "conferencePaper", "converted first: Zotero merges items of one type");
	assert.equal(eprint.deleted, true);
	assert.equal(published.attachments.length, 1, "the preprint's PDF moved over");
	assert.match(published.getField("extra"), /^IACR ePrint: 2016\/191$/m);
	assert.equal(published.getField("proceedingsTitle"), "Advances in Cryptology – CRYPTO 2016", "the published metadata stays");
	assert.equal((await finder.find(1, { scope: new Set([published.id]) })).groups.length, 0, "one item left");
});

test("merging a preprint records its ePrint id on the published version and refuses a preprint as target", async () => {
	const { finder, published, eprint } = kmp16();
	published.setField("extra", "");
	const [group] = (await finder.find(1, { scope: new Set([published.id]) })).groups;
	await assert.rejects(finder.mergeVersions(group, eprint.id), /no longer in the library/);
	await finder.mergeVersions(group, published.id);
	assert.match(published.getField("extra"), /^IACR ePrint: 2016\/191$/m, "taken from the preprint");
});

test("a group marked as different papers stays hidden; the scope limits the report", async () => {
	const { finder, prefs, preprint, unrelated } = library();
	const [group] = (await finder.find(1)).groups;
	finder.dismiss(group);
	assert.deepEqual(JSON.parse(prefs.get("duplicatesDismissed")), [group.id]);
	assert.equal((await finder.find(1)).groups.length, 0);
	prefs.set("duplicatesDismissed", "not json");
	assert.equal((await finder.find(1)).groups.length, 1, "a broken preference is ignored");
	assert.equal((await finder.find(1, { scope: new Set([unrelated.id]) })).groups.length, 0);
	assert.equal((await finder.find(1, { scope: new Set([preprint.id]) })).groups.length, 1);
});

test("the report window's actions update the group they belong to", async () => {
	const { Zotero, finder, conference, preprint } = library();
	const l10n = { format: (id, args) => (args ? `${id} ${JSON.stringify(args)}` : id) };
	const view = new DuplicatesView({ Zotero, l10n, finder, log: () => {} });
	let opened;
	const parentWindow = { openDialog: (url, name, features, io) => (opened = { url, io }) };
	view.open(parentWindow, await finder.find(1), "My Library");
	assert.match(opened.url, /^chrome:\/\/iacr-tools\/content\/duplicates\.xhtml$/);
	const [group] = view.state.groups;
	assert.equal(group.keep[0], conference.id, "the CryptoBib-keyed copy is kept by default");
	assert.equal(group.clusters[0][0].type, "conferencePaper");

	const changes = [];
	view.subscribe((state, change) => changes.push(change?.group));
	await view.merge(group.id, 0, group.keep[0]);
	assert.equal(group.result, null, "versions are left to link");
	assert.match(group.note, /dup-merged/);
	assert.deepEqual(group.clusters.map((cluster) => cluster.length), [1, 1]);

	await view.linkAll();
	assert.match(group.result.text, /dup-linked/);
	assert.ok(preprint.relatedItems.includes(conference.key));
	assert.ok(changes.every((id) => id === group.id));

	// A finished group ignores further clicks; errors are shown on the card.
	await view.dismiss(group.id);
	assert.match(group.result.text, /dup-linked/);
});

test("the report offers Merge into One Item for a linked preprint, and the card is done afterwards", async () => {
	const { Zotero, finder, published, eprint } = kmp16();
	const l10n = { format: (id, args) => (args ? `${id} ${JSON.stringify(args)}` : id) };
	const view = new DuplicatesView({ Zotero, l10n, finder, log: () => {} });
	view.open({ openDialog: () => ({}) }, await finder.find(1, { scope: new Set([eprint.id]) }), "Non-Interactive Assumptions");
	const [group] = view.state.groups;
	assert.equal(group.linked, true, "shown with the Linked badge");
	assert.deepEqual(group.mergeTargets.map((target) => target.id), [published.id]);
	assert.equal(group.mergeTarget, published.id);
	assert.equal(group.mergeTargets[0].label, "Advances in Cryptology – CRYPTO 2016, 2016");

	await view.mergeVersions(group.id, group.mergeTarget);
	assert.match(group.result.text, /dup-merged-versions .*Optimal Security Proofs/);
	assert.deepEqual(group.clusters.map((cluster) => cluster.map((paper) => paper.id)), [[published.id]]);
	assert.deepEqual(group.mergeTargets, [], "nothing left to merge");
});
