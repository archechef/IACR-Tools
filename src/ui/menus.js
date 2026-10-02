/**
 * Menus registered through Zotero.MenuManager (Zotero 8+).
 *
 * Papers and collections get the same IACR submenu (MENU_LAYOUT): "Update
 * All" on top, then one submenu per purpose. On papers its entries apply to
 * the selected items, on a collection to the collection's papers (or a whole
 * library's). The imports also stay in the File menu.
 */
import { ASSETS, PLUGIN } from "../config.js";
import { L10n } from "./l10n.js";

/**
 * @typedef {"items" | "collection"} MenuScope
 * @typedef {{ command: string }} CommandEntry   A pipeline command from COMMANDS (plugin.js).
 * @typedef {{
 *   id: string,
 *   items?: (plugin: import("../plugin.js").IACRTools, context: any) => any,
 *   collection?: (plugin: import("../plugin.js").IACRTools, context: any) => any,
 *   showing?: (plugin: import("../plugin.js").IACRTools, context: any) => boolean,
 * }} ActionEntry  Fluent id `menu-<id>`; an entry without a handler for a scope is left out there.
 * @typedef {{ group: string, entries: Array<CommandEntry | ActionEntry> }} GroupEntry  Fluent id `menu-group-<group>`.
 * @typedef {CommandEntry | ActionEntry | GroupEntry | "separator"} LayoutEntry
 */

/**
 * The IACR submenu. Every command in COMMANDS must appear here once (the
 * bundle test checks this).
 * @type {ReadonlyArray<LayoutEntry>}
 */
export const MENU_LAYOUT = Object.freeze([
	{ command: "process-all" },
	"separator",
	{
		group: "metadata",
		entries: [{ command: "sync-cryptobib" }, { command: "convert-springer" }, { command: "upgrade-preprints" }],
	},
	{
		group: "eprint",
		entries: [
			{ command: "find-eprint" },
			{ command: "download-eprint" },
			{ command: "download-doi-pdf" },
			{ command: "check-eprint-revisions" },
			{
				id: "open-eprint",
				// One browser tab per paper: offered for a selection, not for whole collections.
				items: (plugin, context) => plugin.openEprintPages(context.items ?? []),
				showing: (plugin, context) => plugin.eprintIdsOf(context.items ?? []).length > 0,
			},
		],
	},
	{
		group: "versions",
		entries: [
			{
				id: "find-duplicates",
				items: (plugin, context) => plugin.findDuplicates({ items: context.items ?? [] }),
				collection: (plugin, context) => plugin.findDuplicates({ context }),
			},
			{ command: "link-versions" },
		],
	},
	{
		group: "export",
		entries: [
			{
				id: "copy-list",
				items: (plugin, context) => plugin.copyAsList(context.items ?? []),
				collection: (plugin, context) => plugin.copyCollectionAsList(context),
			},
			{
				id: "copy-latex",
				items: (plugin, context) => plugin.copyLatexCitation(context.items ?? []),
				collection: (plugin, context) => plugin.copyCollectionLatexCitation(context),
			},
			{
				id: "export-bibtex",
				items: (plugin, context) => plugin.exportBibTeXNotInCryptoBib(context.items ?? []),
				collection: (plugin, context) => plugin.exportCollectionBibTeX(context),
			},
		],
	},
	{
		group: "add",
		entries: [
			{ id: "add-list-here", collection: (plugin, context) => plugin.addPapersFromList(context) },
			{ id: "import-folder-here", collection: (plugin, context) => plugin.importFolder(context) },
		],
	},
]);

/**
 * The MenuManager entries of the IACR submenu for one scope.
 * @param {import("../plugin.js").IACRTools} plugin
 * @param {MenuScope} scope
 */
export function iacrMenuEntries(plugin, scope) {
	const runCommand = (id) => (scope === "items"
		? (event, context) => plugin.runCommand(id, context.items ?? [])
		: (event, context) => plugin.runCollectionCommand(id, context));

	/** @param {LayoutEntry} entry */
	const build = (entry) => {
		if (entry === "separator") return { menuType: "separator" };
		if ("command" in entry) {
			return { menuType: "menuitem", l10nID: L10n.id(`menu-${entry.command}`), onCommand: runCommand(entry.command) };
		}
		if ("group" in entry) {
			const menus = entry.entries.map(build).filter(Boolean);
			return menus.length ? { menuType: "submenu", l10nID: L10n.id(`menu-group-${entry.group}`), menus } : null;
		}
		const handler = entry[scope];
		if (!handler) return null;
		return {
			menuType: "menuitem",
			l10nID: L10n.id(`menu-${entry.id}`),
			onCommand: (event, context) => handler(plugin, context),
			...(entry.showing && {
				onShowing: (event, context) => context.setVisible(entry.showing(plugin, context)),
			}),
		};
	};
	const menus = MENU_LAYOUT.map(build).filter(Boolean);
	// A separator that ended up last (nothing after it for this scope) is dropped.
	while (menus.at(-1)?.menuType === "separator") menus.pop();
	return menus;
}

/**
 * @param {object} deps
 * @param {any} deps.Zotero
 * @param {string} deps.rootURI
 * @param {import("../plugin.js").IACRTools} deps.plugin
 * @returns {string[]} Registered menu ids (for unregistering).
 */
export function registerMenus({ Zotero, rootURI, plugin }) {
	const iacrSubmenu = (scope) => ({
		menuType: "submenu",
		l10nID: L10n.id("menu-root"),
		icon: rootURI + ASSETS.icon,
		menus: iacrMenuEntries(plugin, scope),
	});

	const itemMenu = Zotero.MenuManager.registerMenu({
		menuID: `${PLUGIN.l10nPrefix}-item`,
		pluginID: PLUGIN.id,
		target: "main/library/item",
		menus: [iacrSubmenu("items")],
	});

	const toolsMenu = Zotero.MenuManager.registerMenu({
		menuID: `${PLUGIN.l10nPrefix}-tools`,
		pluginID: PLUGIN.id,
		target: "main/menubar/tools",
		menus: [
			{
				menuType: "menuitem",
				l10nID: L10n.id("menu-update-cryptobib"),
				onCommand: () => plugin.updateCryptoBib(),
			},
			{
				menuType: "menuitem",
				l10nID: L10n.id("menu-find-library-duplicates"),
				onCommand: () => plugin.findDuplicates(),
			},
		],
	});

	const fileMenu = Zotero.MenuManager.registerMenu({
		menuID: `${PLUGIN.l10nPrefix}-file`,
		pluginID: PLUGIN.id,
		target: "main/menubar/file",
		menus: [
			{
				menuType: "menuitem",
				l10nID: L10n.id("menu-import-folder"),
				icon: rootURI + ASSETS.icon,
				onCommand: (event, context) => plugin.importFolder(context),
			},
			{
				menuType: "menuitem",
				l10nID: L10n.id("menu-add-list"),
				icon: rootURI + ASSETS.icon,
				onCommand: (event, context) => plugin.addPapersFromList(context),
			},
		],
	});

	const collectionMenu = Zotero.MenuManager.registerMenu({
		menuID: `${PLUGIN.l10nPrefix}-collection`,
		pluginID: PLUGIN.id,
		target: "main/library/collection",
		menus: [iacrSubmenu("collection")],
	});

	return [itemMenu, toolsMenu, fileMenu, collectionMenu].filter(Boolean);
}

export function unregisterMenus(Zotero, ids) {
	for (const id of ids) Zotero.MenuManager.unregisterMenu(id);
}
