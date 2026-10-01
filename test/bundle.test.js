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
	const registered = { menus: [], columns: [], panes: [], progress: [] };
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
	return { Zotero, Services, IOUtils, PathUtils, ChromeUtils, registered, defaults, timers };
}

test("the built plugin starts, registers its UI and runs its commands", { skip: !existsSync(addonDir) }, async () => {
	const dataDir = mkdtempSync(join(tmpdir(), "iacr-tools-bundle-"));
	const env = createEnvironment(dataDir);
	const scope = vm.createContext({
		Zotero: env.Zotero, Services: env.Services, IOUtils: env.IOUtils, PathUtils: env.PathUtils,
		ChromeUtils: env.ChromeUtils, APP_SHUTDOWN: 2, console,
	});
	vm.runInContext(readFileSync(new URL("bootstrap.js", addonDir), "utf8"), scope);
	await vm.runInContext("startup({ rootURI: 'rootURI:' })", scope);

	const plugin = env.Zotero[PLUGIN.globalName];
	assert.ok(plugin, "plugin exposed on Zotero");
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
	await command("process-all").onCommand(null, { items: [item] });

	assert.equal(item.itemType, "conferencePaper");
	assert.equal(item.getField("citationKey"), "EC:GHKR08");
	assert.equal(item.getField("conferenceName"), "EUROCRYPT 2008");
	assert.match(item.getField("extra"), /^IACR ePrint: 2008\/045$/m);
	assert.equal(env.registered.columns[0].dataProvider(item), "2008/045");

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
		confirm: (window, options) => (asked.push(options), { confirmed: true, secondary: false, checked: options.checkLabel.includes("list") }),
		alert: (window, title, text) => asked.push({ title, text }),
	};
	const fileMenu = env.registered.menus.find((m) => m.target === "main/menubar/file");
	assert.equal(fileMenu.menus[0].l10nID, `${PLUGIN.l10nPrefix}-menu-import-folder`);
	await fileMenu.menus[0].onCommand(null, {});
	assert.equal(asked.length, 1);
	assert.match(asked[0].text, /import-confirm .*"new":1/);
	assert.equal(env.Zotero.Prefs.get(`${PLUGIN.prefBranch}folderImport.findEprint`), false, "checkbox remembered");
	const importProgress = env.registered.progress.at(-1);
	assert.equal(importProgress.headline, `${PLUGIN.l10nPrefix}-progress-import-folder`);
	assert.ok(importProgress.lines.some((line) => /import-summary.*"unrecognized":1/.test(line.text)), "import summary shown");
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
	assert.ok(pasted[0].url.endsWith("content/list-dialog.xhtml"), "the plugin's own dialog is opened");
	assert.match(pasted[0].io.text, /EC:GHKR08/, "pre-filled from the clipboard");
	assert.match(pasted[0].io.description, /"target":"Crypto"/, "the destination is named");
	// The library already holds this paper (it was processed above), so the list
	// updates it instead of adding a second item, and fetches its ePrint PDF.
	const matching = (await env.Zotero.Items.getAll(1)).filter((item) => item.isRegularItem?.() && item.getField("citationKey") === "EC:GHKR08");
	assert.equal(matching.length, 1, "no duplicate item");
	assert.ok(matching[0].inCollection(target.id), "filed in the selected collection");
	assert.equal(matching[0].attachments[0]?.url, "https://eprint.iacr.org/2008/045.pdf", "ePrint PDF downloaded");
	const listProgress = env.registered.progress.at(-1);
	assert.equal(listProgress.headline, `${PLUGIN.l10nPrefix}-progress-add-list`);
	assert.ok(listProgress.lines.some((line) => /list-summary.*"updated":1/.test(line.text)), "list summary shown");

	// The IACR submenu copies the selected papers back out as a list.
	const copy = submenu.find((m) => m.l10nID?.endsWith("copy-list"));
	copy.onCommand(null, { items: matching });
	const copied = env.Zotero.copied.at(-1);
	assert.match(copied, /^# iacr-tools-copy-header/, "the list carries a header comment");
	assert.match(copied, /^2008\/045\s+# Threshold RSA for Dynamic and Ad-Hoc Groups$/m);

	// Without the paste box (older Zotero, or a dialog that fails to load) the
	// command falls back to the clipboard and a plain confirmation.
	plugin.dialogs.pasteList = () => {
		throw new Error("no dialog here");
	};
	await listItem.onCommand(null, {});
	assert.match(asked.at(-1).text, /list-confirm .*"count":1/, "fallback confirmation shown");

	await vm.runInContext("shutdown({}, 1)", scope);
	assert.equal(env.Zotero[PLUGIN.globalName], undefined);
	env.timers.clearAll();
	rmSync(dataDir, { recursive: true, force: true });
});
