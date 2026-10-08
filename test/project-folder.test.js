/**
 * Linking a project folder to its collection: the refs/papers link to
 * ZotMoov's folder and Better BibTeX's export of refs/references.bib. The
 * file system is real (a temporary folder); the link is a junction made by
 * Node, standing in for mklink.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { access, lstat, mkdir, readdir, rm, rmdir, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { LATEX } from "../src/config.js";
import { samePath, zotmoovCollectionFolders, zotmoovFolderName } from "../src/core/project-folder.js";
import { ProjectFolders } from "../src/zotero/project-folder.js";
import { createFakeZotero } from "./fake-zotero.js";

const nodeFiles = {
	join,
	exists: (path) => access(path).then(() => true, () => false),
	readText: async () => "",
	writeText: (path, text) => writeFile(path, text),
	makeDirectory: (path) => mkdir(path, { recursive: true }).then(() => {}),
	async remove(path) {
		// Like IOUtils.remove without `recursive`: a folder must be empty.
		const s = await lstat(path).catch(() => null);
		if (s?.isDirectory()) await rmdir(path);
		else if (s) await rm(path);
	},
	async stat(path) {
		const s = await stat(path);
		return { type: s.isDirectory() ? "directory" : "regular", size: s.size };
	},
	children: async (path) => (await readdir(path)).map((name) => join(path, name)),
	basename,
	md5: async () => false,
};

/**
 * Better BibTeX's AutoExport as its scripting API uses it: entries keyed by
 * path; `add` stores one (and would run it).
 */
function fakeBetterBibTeX() {
	const entries = new Map();
	return {
		ready: Promise.resolve(),
		AutoExport: {
			added: [],
			all: () => [...entries.values()],
			get: (path) => entries.get(path),
			async add(entry, schedule) {
				this.added.push({ entry, schedule });
				entries.set(entry.path, entry);
			},
		},
	};
}

async function setUp(t, { zotmoov = true, bbt = true } = {}) {
	const root = mkdtempSync(join(tmpdir(), "iacr-tools-project-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const Zotero = createFakeZotero();
	const phd = new Zotero.Collection({ libraryID: 1, name: "Phd" });
	await phd.saveTx();
	const project = new Zotero.Collection({ libraryID: 1, name: "Tight PRF", parentID: phd.id });
	await project.saveTx();
	const zoteroFolder = join(root, "Zotero");
	if (zotmoov) {
		Zotero.ZotMoov = {};
		Zotero.Prefs.set("extensions.zotmoov.dst_dir", zoteroFolder);
		Zotero.Prefs.set("extensions.zotmoov.enable_subdir_move", true);
		Zotero.Prefs.set("extensions.zotmoov.subdirectory_string", "{%c}");
	}
	if (bbt) Zotero.BetterBibTeX = fakeBetterBibTeX();
	const links = [];
	const folders = new ProjectFolders({
		Zotero,
		files: nodeFiles,
		makeLink: async (link, target) => (links.push({ link, target }), symlink(target, link, "junction")),
		log: () => {},
	});
	const projectFolder = join(root, "tight-prf");
	await mkdir(projectFolder);
	return { Zotero, project, folders, projectFolder, zoteroFolder, links, papersFolder: join(zoteroFolder, "Phd", "Tight PRF") };
}

test("collection names become folder names the way ZotMoov writes them", () => {
	assert.equal(zotmoovFolderName("PRF/PRP"), "PRF_PRP");
	assert.equal(zotmoovFolderName("What? Signatures: a survey"), "What_ Signatures_ a survey");
	assert.equal(zotmoovFolderName("Topic."), "Topic_");
	assert.equal(zotmoovFolderName("con"), "_");
	assert.deepEqual(zotmoovCollectionFolders(["Phd", "Project", "A<B"]), ["Phd", "Project", "A_B"]);
	assert.deepEqual(zotmoovCollectionFolders([..."abcdefghijkl"]), [..."cdefghijkl"], "the deepest ten levels");
	assert.ok(samePath("C:\\Users\\x\\refs\\", "C:/Users/x/refs"));
	assert.ok(samePath("C:/users/X", "C:/Users/x", { ignoreCase: true }));
	assert.ok(!samePath("C:/users/X", "C:/Users/x"));
});

test("a project folder gets refs/papers linked to the collection's ZotMoov folder and an exported references.bib", async (t) => {
	const { project, folders, projectFolder, links, papersFolder, Zotero } = await setUp(t);
	const plan = await folders.plan(project, projectFolder);
	const link = join(projectFolder, "refs", "papers");
	const bib = join(projectFolder, "refs", "references.bib");
	assert.deepEqual(plan.papers, { link, target: papersFolder, state: "create" });
	assert.deepEqual(plan.bibliography, { path: bib, state: "create", replacesFile: false });
	assert.equal(await nodeFiles.exists(join(projectFolder, "refs")), false, "planning changes nothing");

	const outcome = await folders.apply(plan);
	assert.deepEqual(outcome, { papers: { state: "created" }, bibliography: { state: "created" } });
	assert.deepEqual(links, [{ link, target: papersFolder }]);
	await writeFile(join(papersFolder, "Bernstein-2008.pdf"), "pdf");
	assert.deepEqual(await readdir(link), ["Bernstein-2008.pdf"], "the PDFs show up in the project, and no probe file is left");
	const [{ entry, schedule }] = Zotero.BetterBibTeX.AutoExport.added;
	assert.equal(schedule, true, "exported right away");
	assert.deepEqual({ type: entry.type, id: entry.id, path: entry.path, translatorID: entry.translatorID, recursive: entry.recursive },
		{ type: "collection", id: project.id, path: bib, translatorID: LATEX.translators.betterBibTeX, recursive: false });

	const again = await folders.plan(project, projectFolder);
	assert.equal(again.papers.state, "linked");
	assert.equal(again.bibliography.state, "exported");
	assert.deepEqual(await folders.apply(again), { papers: { state: "unchanged" }, bibliography: { state: "unchanged" } });
	assert.equal(links.length, 1, "nothing is linked twice");
});

test("an empty refs/papers folder is replaced, anything else is left alone", async (t) => {
	const { project, folders, projectFolder, links } = await setUp(t);
	const link = join(projectFolder, "refs", "papers");
	await mkdir(link, { recursive: true });
	const plan = await folders.plan(project, projectFolder);
	assert.equal(plan.papers.state, "create");
	assert.equal(plan.papers.replacesEmptyFolder, true);
	assert.equal((await folders.apply(plan)).papers.state, "created");

	await rm(link);
	await mkdir(link);
	await writeFile(join(link, "mine.pdf"), "pdf");
	const occupied = await folders.plan(project, projectFolder);
	assert.equal(occupied.papers.state, "occupied");
	await folders.apply(occupied);
	assert.deepEqual(await readdir(link), ["mine.pdf"]);
	assert.equal(links.length, 1);
});

test("an export of something else to references.bib is left alone; an existing file is overwritten by the export", async (t) => {
	const { project, folders, projectFolder, Zotero } = await setUp(t);
	const bib = join(projectFolder, "refs", "references.bib");
	await mkdir(join(projectFolder, "refs"));
	await writeFile(bib, "@misc{x}");
	assert.deepEqual((await folders.plan(project, projectFolder)).bibliography, { path: bib, state: "create", replacesFile: true });

	await Zotero.BetterBibTeX.AutoExport.add({ type: "library", id: 1, path: bib, translatorID: LATEX.translators.betterBibTeX });
	const plan = await folders.plan(project, projectFolder);
	assert.equal(plan.bibliography.state, "occupied");
	assert.equal((await folders.apply(plan)).bibliography.state, "unchanged");
});

test("without ZotMoov's collection folders or Better BibTeX, the missing part is skipped with the reason", async (t) => {
	const none = await setUp(t, { zotmoov: false, bbt: false });
	const plan = await none.folders.plan(none.project, none.projectFolder);
	assert.deepEqual(plan.papers, { link: join(none.projectFolder, "refs", "papers"), target: null, state: "unavailable", reason: "zotmoov-missing" });
	assert.equal(plan.bibliography.state, "unavailable");
	assert.deepEqual(await none.folders.apply(plan), { papers: { state: "unchanged" }, bibliography: { state: "unchanged" } });
	assert.equal(await nodeFiles.exists(join(none.projectFolder, "refs")), false);

	const other = await setUp(t);
	other.Zotero.Prefs.set("extensions.zotmoov.subdirectory_string", "{%y}");
	assert.equal((await other.folders.plan(other.project, other.projectFolder)).papers.reason, "zotmoov-subfolders");
	other.Zotero.Prefs.set("extensions.zotmoov.dst_dir", "");
	assert.equal((await other.folders.plan(other.project, other.projectFolder)).papers.reason, "zotmoov-no-folder");
});

test("a failing link is reported, not thrown", async (t) => {
	const { Zotero, project, projectFolder } = await setUp(t);
	const folders = new ProjectFolders({ Zotero, files: nodeFiles, makeLink: async () => { throw new Error("mklink failed"); }, log: () => {} });
	const outcome = await folders.apply(await folders.plan(project, projectFolder));
	assert.deepEqual(outcome.papers, { state: "failed", error: "mklink failed" });
	assert.equal(outcome.bibliography.state, "created");
});
