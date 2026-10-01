/**
 * Smoke test of the built plugin: runs build/addon/bootstrap.js and the bundled
 * script in a VM with a fake Zotero, then drives the registered menus.
 * Skipped unless `npm run build` has been run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile, access, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import vm from "node:vm";

import { PLUGIN } from "../src/config.js";
import { createFakeZotero } from "./fake-zotero.js";

const addonDir = new URL("../build/addon/", import.meta.url);
const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

// Option names accepted by Zotero's plugin APIs (pluginAPI/*.js, preferencePanes.js); unknown ones throw.
const COLUMN_OPTIONS = ["dataKey", "label", "pluginID", "enabledTreeIDs", "defaultIn", "disableIn", "sortReverse", "flex",
	"width", "fixedWidth", "staticWidth", "noPadding", "minWidth", "iconLabel", "iconPath", "htmlLabel",
	"showInColumnPicker", "columnPickerSubMenu", "dataProvider", "renderCell"];
const MENU_OPTIONS = ["menuType", "l10nID", "l10nArgs", "icon", "darkIcon", "enableForTabTypes", "onShowing", "onShown",
	"onHiding", "onHidden", "onCommand", "menus"];
const PANE_OPTIONS = ["pluginID", "src", "id", "parent", "label", "image", "scripts", "stylesheets", "helpURL", "defaultXUL"];

function checkKeys(options, allowed) {
	for (const key of Object.keys(options)) assert.ok(allowed.includes(key), `unknown option ${key}`);
}

function checkMenu({ menuID, pluginID, target, menus }) {
	assert.ok(menuID && pluginID && target);
	const walk = (list) => list.forEach((menu) => (checkKeys(menu, MENU_OPTIONS), walk(menu.menus ?? [])));
	walk(menus);
}

function createEnvironment(dataDir) {
	const Zotero = createFakeZotero({ clipboard: "# reading list\nEC:GHKR08\n" });
	const registered = { menus: [], columns: [], panes: [], progress: [], chrome: [], dialogs: [] };
	const defaults = new Map();
	Object.assign(Zotero, {
		initializationPromise: Promise.resolve(),
		DataDirectory: { dir: dataDir },
		HTTP: {
			async request(method, url) {
				if (url.endsWith(".bib")) {
					return { responseText: url.endsWith("crypto.bib") ? fixture("crypto.bib") : fixture("abbrev0.bib") };
				}
				throw new Error(`offline: ${url}`);
			},
		},
		PreferencePanes: { register: async (options) => (checkKeys(options, PANE_OPTIONS), registered.panes.push(options)) },
		ItemTreeManager: {
			registerColumn: (options) => (checkKeys(options, COLUMN_OPTIONS), registered.columns.push(options), `${options.pluginID}-${options.dataKey}`),
			unregisterColumn: () => true,
		},
		MenuManager: {
			registerMenu: (options) => (checkMenu(options), registered.menus.push(options), options.menuID),
			unregisterMenu: () => true,
		},
		getMainWindows: () => [],
		getMainWindow: () => ({
			Localization: class {
				formatValueSync(id, args) {
					return args ? `${id} ${JSON.stringify(args)}` : id;
				}
			},
			// The progress window: recorded; `registered.closeDialogs` makes the
			// user close it right away.
			openDialog(url, name, features, io) {
				const window = { url, io, closed: Boolean(registered.closeDialogs), close() { this.closed = true; } };
				registered.dialogs.push(window);
				return window;
			},
		}),
		ProgressWindow: class {
			constructor() {
				this.lines = [];
				registered.progress.push(this);
				const lines = this.lines;
				this.ItemProgress = class {
					constructor(type, text) {
						this.text = text;
						lines.push(this);
					}
					setText(text) {
						this.text = text;
					}
					setProgress() {}
					setError() {
						this.error = true;
					}
				};
			}
			changeHeadline(text) {
				this.headline = text;
			}
			show() {}
			addDescription(text) {
				this.description = text;
			}
			startCloseTimer() {}
			close() {
				this.closed = true;
			}
		},
	});
	const Services = {
		io: { newURI: (spec) => ({ spec }) },
		prefs: {
			getDefaultBranch: () => ({
				setBoolPref: (k, v) => defaults.set(k, v),
				setIntPref: (k, v) => defaults.set(k, v),
				setStringPref: (k, v) => defaults.set(k, v),
			}),
		},
		scriptloader: {
			loadSubScript(url, scope) {
				const path = new URL(url.replace("rootURI:", ""), addonDir);
				vm.runInContext(readFileSync(path, "utf8"), vm.createContext(scope), { filename: path.pathname });
			},
		},
	};
	const IOUtils = {
		exists: (path) => access(path).then(() => true, () => false),
		readUTF8: (path) => readFile(path, "utf8"),
		writeUTF8: (path, text) => writeFile(path, text),
		makeDirectory: (path) => mkdir(path, { recursive: true }),
		async stat(path) {
			const s = await stat(path);
			return { type: s.isDirectory() ? "directory" : "regular", size: s.size };
		},
		getChildren: async (path) => (await readdir(path)).map((name) => join(path, name)),
	};
	const PathUtils = { join, filename: basename };
	Zotero.Utilities.Internal.md5Async = async (path) => createHash("md5").update(await readFile(path)).digest("hex");
	const timerIDs = new Set();
	const timers = {
		setTimeout: (fn, ms) => {
			const id = setTimeout(fn, ms > 1000 ? 2 ** 31 - 1 : ms);
			timerIDs.add(id);
			return id;
		},
		clearTimeout: (id) => clearTimeout(id),
		clearAll: () => timerIDs.forEach(clearTimeout),
	};
	const ChromeUtils = { importESModule: () => timers };
	const Ci = { amIAddonManagerStartup: "amIAddonManagerStartup" };
	const Cc = {
		"@mozilla.org/addons/addon-manager-startup;1": {
			getService: () => ({
				registerChrome(manifestURI, entries) {
					const registration = { manifest: manifestURI.spec, entries, destructed: false };
					registered.chrome.push(registration);
					return { destruct: () => (registration.destructed = true) };
				},
			}),
		},
	};
	return { Zotero, Services, IOUtils, PathUtils, ChromeUtils, Cc, Ci, registered, defaults, timers };
}

test("the built plugin starts, registers its UI and runs its commands", { skip: !existsSync(addonDir) }, async (t) => {
	const dataDir = mkdtempSync(join(tmpdir(), "iacr-tools-bundle-"));
	const env = createEnvironment(dataDir);
	// Clear the long-running timers even when an assertion fails, so the run ends.
	t.after(() => env.timers.clearAll());
	const scope = vm.createContext({
		Zotero: env.Zotero, Services: env.Services, IOUtils: env.IOUtils, PathUtils: env.PathUtils,
		ChromeUtils: env.ChromeUtils, Cc: env.Cc, Ci: env.Ci, APP_SHUTDOWN: 2, console,
	});
	vm.runInContext(readFileSync(new URL("bootstrap.js", addonDir), "utf8"), scope);
	await vm.runInContext("startup({ rootURI: 'rootURI:' })", scope);

	const plugin = env.Zotero[PLUGIN.globalName];
	assert.ok(plugin, "plugin exposed on Zotero");
	// (JSON: the arrays come from the sandbox, with its own Array prototype.)
	assert.deepEqual(JSON.parse(JSON.stringify(env.registered.chrome.map(({ manifest, entries }) => ({ manifest, entries })))), [
		{ manifest: "rootURI:manifest.json", entries: [["content", PLUGIN.chromePackage, "content/"]] },
	], "content/ registered as a chrome package");
	assert.equal(env.defaults.get(`${PLUGIN.prefBranch}autoConvertSpringer`), true);
	assert.equal(env.registered.panes.length, 1);
	assert.equal(env.registered.columns[0].dataKey, "eprint");
	assert.deepEqual(env.registered.menus.map((m) => m.target), ["main/library/item", "main/menubar/tools", "main/menubar/file", "main/library/collection"]);

	const item = env.Zotero.addItem("bookSection", {
		fields: { title: "Threshold RSA for Dynamic and Ad-Hoc Groups", bookTitle: "EUROCRYPT 2008", date: "2008", extra: "DOI: 10.1007/978-3-540-78967-3_6" },
		creators: [{ firstName: "R.", lastName: "Gennaro", creatorType: "author" }],
	});
	const submenu = env.registered.menus[0].menus[0].menus;
	const command = (id) => submenu.find((m) => m.l10nID === `${PLUGIN.l10nPrefix}-menu-${id}`);
	env.registered.closeDialogs = true;
	await command("process-all").onCommand(null, { items: [item] });
	env.registered.closeDialogs = false;

	assert.equal(item.itemType, "conferencePaper");
	assert.equal(item.getField("citationKey"), "EC:GHKR08");
	assert.equal(item.getField("conferenceName"), "EUROCRYPT 2008");
	assert.match(item.getField("extra"), /^IACR ePrint: 2008\/045$/m);
	assert.equal(env.registered.columns[0].dataProvider(item), "2008/045");

	// The command reports in its own window; it was closed before the end, so
	// the outcome also appears in Zotero's pop-up.
	const progressWindow = env.registered.dialogs.at(-1);
	assert.equal(progressWindow.url, `chrome://${PLUGIN.chromePackage}/content/progress.xhtml`);
	const { state } = progressWindow.io;
	assert.equal(state.headline, `${PLUGIN.l10nPrefix}-progress-process-all`);
	assert.equal(state.finished, true);
	assert.deepEqual([state.done, state.total], [1, 1]);
	assert.equal(state.rows.length, 1);
	assert.match(state.rows[0].title, /Threshold RSA/);
	assert.match(state.status, /summary.*"changed":1/);
	const progress = env.registered.progress.at(-1);
	assert.equal(progress.headline, `${PLUGIN.l10nPrefix}-progress-process-all`);
	assert.ok(progress.lines.some((line) => /summary.*"changed":1/.test(line.text)), "summary shown");

	let visible;
	const open = submenu.find((m) => m.l10nID?.endsWith("open-eprint"));
	open.onShowing(null, { items: [item], setVisible: (v) => (visible = v) });
	assert.equal(visible, true);
	open.onCommand(null, { items: [item] });
	assert.deepEqual(env.Zotero.launched, ["https://eprint.iacr.org/2008/045"]);

	// File → Import PDFs from Folder… into the selected collection, on a Zotero
	// version whose ZoteroPane only has the singular selection accessors.
	const target = new env.Zotero.Collection({ libraryID: 1, name: "Crypto" });
	await target.saveTx();
	const mainWindow = env.Zotero.getMainWindow();
	env.Zotero.getMainWindow = () => ({
		...mainWindow,
		ZoteroPane: { getSelectedCollection: () => target, getSelectedLibraryID: () => 1 },
	});
	env.Zotero.Prefs.set(`${PLUGIN.prefBranch}folderImport.subcollections`, false);

	const folder = join(dataDir, "papers");
	await mkdir(join(folder, "sub"), { recursive: true });
	await writeFile(join(folder, "sub", "unknown.pdf"), "%PDF unknown");
	const asked = [];
	plugin.dialogs = {
		pickFolder: async () => folder,
		pickFile: async () => null,
		// Answer the folder import's checkbox with "no" and the list's with "yes"
		// (the fake Localization formats a message to its id).
		confirm: (window, options) => (asked.push(options), { confirmed: true, secondary: false, checked: Boolean(options.checkLabel?.includes("list")) }),
		alert: (window, title, text) => asked.push({ title, text }),
	};
	const fileMenu = env.registered.menus.find((m) => m.target === "main/menubar/file");
	assert.equal(fileMenu.menus[0].l10nID, `${PLUGIN.l10nPrefix}-menu-import-folder`);
	await fileMenu.menus[0].onCommand(null, {});
	assert.equal(asked.length, 1);
	assert.match(asked[0].text, /import-confirm .*"new":1/);
	assert.equal(env.Zotero.Prefs.get(`${PLUGIN.prefBranch}folderImport.findEprint`), false, "checkbox remembered");
	const importProgress = env.registered.dialogs.at(-1).io.state;
	assert.equal(importProgress.headline, `${PLUGIN.l10nPrefix}-progress-import-folder`);
	assert.match(importProgress.status, /import-summary.*"unrecognized":1/, "import summary shown");
	assert.match(asked[0].text, /"target":"Crypto"/);
	assert.deepEqual(env.Zotero.collectionPaths(), ["Crypto"], "no collections created for the folders");
	const imported = (await env.Zotero.Items.getAll(1)).filter((item) => item.isFileAttachment?.());
	assert.equal(imported.length, 1);
	assert.ok(imported[0].inCollection(target.id), "the PDF is in the selected collection");

	// File → Add Papers from a List…: the paste box opens, pre-filled from the clipboard.
	const pasted = [];
	plugin.dialogs.pasteList = (window, url, io) => {
		pasted.push({ url, io: { ...io } });
		return { ...io, loaded: true, action: "add", text: "EC:GHKR08", download: true };
	};
	const listItem = fileMenu.menus[1];
	assert.equal(listItem.l10nID, `${PLUGIN.l10nPrefix}-menu-add-list`);
	await listItem.onCommand(null, {});
	assert.equal(pasted.length, 1);
	assert.equal(pasted[0].url, `chrome://${PLUGIN.chromePackage}/content/list-dialog.xhtml`, "the paste box is opened from the chrome package");
	assert.match(pasted[0].io.text, /EC:GHKR08/, "pre-filled from the clipboard");
	assert.match(pasted[0].io.description, /"target":"Crypto"/, "the destination is named");
	// The library already holds this paper (it was processed above), so the list
	// updates it instead of adding a second item, and fetches its ePrint PDF.
	const matching = (await env.Zotero.Items.getAll(1)).filter((item) => item.isRegularItem?.() && item.getField("citationKey") === "EC:GHKR08");
	assert.equal(matching.length, 1, "no duplicate item");
	assert.ok(matching[0].inCollection(target.id), "filed in the selected collection");
	assert.equal(matching[0].attachments[0]?.url, "https://eprint.iacr.org/2008/045.pdf", "ePrint PDF downloaded");
	const listProgress = env.registered.dialogs.at(-1).io.state;
	assert.equal(listProgress.headline, `${PLUGIN.l10nPrefix}-progress-add-list`);
	assert.match(listProgress.status, /list-summary.*"updated":1/, "list summary shown");

	// The IACR submenu copies the selected papers back out as a list.
	const copy = submenu.find((m) => m.l10nID?.endsWith("copy-list"));
	copy.onCommand(null, { items: matching });
	const copied = env.Zotero.copied.at(-1);
	assert.match(copied, /^# iacr-tools-copy-header/, "the list carries a header comment");
	assert.match(copied, /^2008\/045\s+# Threshold RSA for Dynamic and Ad-Hoc Groups$/m);

	// The new commands are in the IACR submenu.
	for (const id of ["check-eprint-revisions", "upgrade-preprints", "link-versions", "copy-latex", "export-bibtex"]) {
		assert.ok(submenu.some((m) => m.l10nID === `${PLUGIN.l10nPrefix}-menu-${id}`), `menu entry ${id}`);
	}

	// LaTeX: a \cite with the CryptoBib key, and a .bib of the papers CryptoBib lacks.
	const latex = submenu.find((m) => m.l10nID?.endsWith("menu-copy-latex"));
	await latex.onCommand(null, { items: matching });
	assert.equal(env.Zotero.copied.at(-1), "\\cite{EC:GHKR08}");
	const musings = env.Zotero.addItem("journalArticle", { fields: { title: "Musings", citationKey: "lovelace1843" } });
	const bibPath = join(dataDir, "out.bib");
	const saveAs = [];
	plugin.dialogs.pickSaveFile = async (window, title, name) => (saveAs.push(name), bibPath);
	const exportBib = submenu.find((m) => m.l10nID?.endsWith("menu-export-bibtex"));
	await exportBib.onCommand(null, { items: [...matching, musings] });
	assert.deepEqual(saveAs, ["papers-not-in-cryptobib.bib"]);
	const bib = await readFile(bibPath, "utf8");
	assert.match(bib, /^% iacr-tools-latex-export-header .*"abbrev":"abbrev0"/, "header names the abbreviation file");
	assert.match(bib, /@journalArticle\{lovelace1843,/);
	assert.doesNotMatch(bib, /GHKR08|Threshold/, "papers in CryptoBib are left to crypto.bib");

	// Duplicate papers: from the Tools menu, the collection menu and the item menu.
	const toolsMenu = env.registered.menus.find((m) => m.target === "main/menubar/tools");
	const findInLibrary = toolsMenu.menus.find((m) => m.l10nID?.endsWith("menu-find-library-duplicates"));
	const collectionMenu = env.registered.menus.find((m) => m.target === "main/library/collection");
	const collectionSubmenu = collectionMenu.menus.find((m) => m.menuType === "submenu").menus;
	assert.ok(collectionSubmenu.some((m) => m.l10nID?.endsWith("menu-find-collection-duplicates")));
	assert.ok(submenu.some((m) => m.l10nID?.endsWith("menu-find-duplicates")));
	const copyOfPaper = env.Zotero.addItem("bookSection", {
		fields: { title: "Threshold RSA for Dynamic and Ad-Hoc Groups", date: "2008", extra: "DOI: 10.1007/978-3-540-78967-3_6" },
		creators: [{ firstName: "R.", lastName: "Gennaro", creatorType: "author" }],
	});
	const reportWindows = env.registered.dialogs.length;
	await findInLibrary.onCommand(null, {});
	const reportWindow = env.registered.dialogs.at(-1);
	assert.equal(env.registered.dialogs.length, reportWindows + 1, "the report opens");
	assert.equal(reportWindow.url, `chrome://${PLUGIN.chromePackage}/content/duplicates.xhtml`);
	const reportGroup = reportWindow.io.state.groups.find((g) => g.clusters.flat().some((p) => p.id === copyOfPaper.id));
	assert.ok(reportGroup, "the copy is reported with the paper it duplicates");

	// The collection menu offers every paper command for the papers of a collection.
	for (const { id } of plugin.commands) {
		assert.ok(collectionSubmenu.some((m) => m.l10nID === `${PLUGIN.l10nPrefix}-menu-${id}`), `collection command ${id}`);
	}
	for (const id of ["copy-collection-list", "copy-latex", "export-collection-bibtex"]) {
		assert.ok(collectionSubmenu.some((m) => m.l10nID === `${PLUGIN.l10nPrefix}-menu-${id}`), `collection entry ${id}`);
	}
	const inCollection = (await plugin.collectionPapers({ collectionTreeRow: { isCollection: () => true, ref: target } })).items;
	assert.deepEqual(inCollection, matching, "the collection's papers (attachments left out)");
	const syncCollection = collectionSubmenu.find((m) => m.l10nID?.endsWith("menu-sync-cryptobib"));
	await syncCollection.onCommand(null, { collectionTreeRow: { isCollection: () => true, ref: target } });
	const collectionRun = env.registered.dialogs.at(-1).io.state;
	assert.equal(collectionRun.headline, `${PLUGIN.l10nPrefix}-progress-sync-cryptobib`);
	assert.deepEqual([collectionRun.total, collectionRun.done], [inCollection.length, inCollection.length]);

	// On a library (right-clicked, so no collection is selected) it covers all
	// papers of the library, after a confirmation.
	const paneWindow = env.Zotero.getMainWindow;
	env.Zotero.getMainWindow = () => ({ ...mainWindow, ZoteroPane: { getSelectedCollection: () => null, getSelectedLibraryID: () => 1 } });
	const libraryPapers = (await env.Zotero.Items.getAll(1)).filter((item) => item.isRegularItem() && !item.deleted);
	await syncCollection.onCommand(null, { collectionTreeRow: { isCollection: () => false, ref: { libraryID: 1 } } });
	assert.match(asked.at(-1).text, new RegExp(`collection-confirm-library .*"count":${libraryPapers.length}`));
	assert.equal(env.registered.dialogs.at(-1).io.state.total, libraryPapers.length);
	env.Zotero.getMainWindow = paneWindow;

	// Preferences: the number of parallel fetches is kept within bounds; without
	// the progress window, commands report in Zotero's pop-up.
	env.Zotero.Prefs.set(`${PLUGIN.prefBranch}concurrency`, 50);
	assert.equal(plugin.concurrency, 8);
	env.Zotero.Prefs.set(`${PLUGIN.prefBranch}concurrency`, "two");
	assert.equal(plugin.concurrency, 4);
	env.Zotero.Prefs.set(`${PLUGIN.prefBranch}progressWindow`, false);
	const windows = env.registered.dialogs.length;
	await command("link-versions").onCommand(null, { items: matching });
	assert.equal(env.registered.dialogs.length, windows, "no window opened");
	assert.equal(env.registered.progress.at(-1).headline, `${PLUGIN.l10nPrefix}-progress-link-versions`);

	// Without the paste box (older Zotero, or a dialog that fails to load) the
	// command falls back to the clipboard and a plain confirmation.
	plugin.dialogs.pasteList = () => {
		throw new Error("no dialog here");
	};
	await listItem.onCommand(null, {});
	assert.match(asked.at(-1).text, /list-confirm .*"count":1/, "fallback confirmation shown");

	await vm.runInContext("shutdown({}, 1)", scope);
	assert.equal(env.Zotero[PLUGIN.globalName], undefined);
	assert.equal(env.registered.chrome[0].destructed, true, "chrome package unregistered");
	env.timers.clearAll();
	rmSync(dataDir, { recursive: true, force: true });
});
