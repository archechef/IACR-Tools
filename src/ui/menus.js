/**
 * Menus registered through Zotero.MenuManager (Zotero 8+).
 */
import { ASSETS, PLUGIN } from "../config.js";
import { L10n } from "./l10n.js";

/**
 * @param {object} deps
 * @param {any} deps.Zotero
 * @param {string} deps.rootURI
 * @param {import("../plugin.js").IACRTools} deps.plugin
 * @returns {string[]} Registered menu ids (for unregistering).
 */
export function registerMenus({ Zotero, rootURI, plugin }) {
	const commandItems = plugin.commands.map((command) => ({
		menuType: "menuitem",
		l10nID: L10n.id(`menu-${command.id}`),
		onCommand: (event, context) => plugin.runCommand(command.id, context.items ?? []),
	}));

	const itemMenu = Zotero.MenuManager.registerMenu({
		menuID: `${PLUGIN.l10nPrefix}-item`,
		pluginID: PLUGIN.id,
		target: "main/library/item",
		menus: [{
			menuType: "submenu",
			l10nID: L10n.id("menu-root"),
			icon: rootURI + ASSETS.icon,
			menus: [
				...commandItems,
				{ menuType: "separator" },
				{
					menuType: "menuitem",
					l10nID: L10n.id("menu-copy-list"),
					onCommand: (event, context) => plugin.copyAsList(context.items ?? []),
				},
				{
					menuType: "menuitem",
					l10nID: L10n.id("menu-copy-latex"),
					onCommand: (event, context) => plugin.copyLatexCitation(context.items ?? []),
				},
				{
					menuType: "menuitem",
					l10nID: L10n.id("menu-export-bibtex"),
					onCommand: (event, context) => plugin.exportBibTeXNotInCryptoBib(context.items ?? []),
				},
				{
					menuType: "menuitem",
					l10nID: L10n.id("menu-open-eprint"),
					onShowing: (event, context) => context.setVisible(plugin.eprintIdsOf(context.items ?? []).length > 0),
					onCommand: (event, context) => plugin.openEprintPages(context.items ?? []),
				},
			],
		}],
	});

	const toolsMenu = Zotero.MenuManager.registerMenu({
		menuID: `${PLUGIN.l10nPrefix}-tools`,
		pluginID: PLUGIN.id,
		target: "main/menubar/tools",
		menus: [{
			menuType: "menuitem",
			l10nID: L10n.id("menu-update-cryptobib"),
			onCommand: () => plugin.updateCryptoBib(),
		}],
	});

	const importMenus = [
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
	];
	const fileMenu = Zotero.MenuManager.registerMenu({
		menuID: `${PLUGIN.l10nPrefix}-file`,
		pluginID: PLUGIN.id,
		target: "main/menubar/file",
		menus: importMenus,
	});
	const collectionMenu = Zotero.MenuManager.registerMenu({
		menuID: `${PLUGIN.l10nPrefix}-collection`,
		pluginID: PLUGIN.id,
		target: "main/library/collection",
		menus: [
			...importMenus,
			{
				menuType: "menuitem",
				l10nID: L10n.id("menu-copy-collection-list"),
				icon: rootURI + ASSETS.icon,
				onCommand: (event, context) => plugin.copyCollectionAsList(context),
			},
			{
				menuType: "menuitem",
				l10nID: L10n.id("menu-export-collection-bibtex"),
				icon: rootURI + ASSETS.icon,
				onCommand: (event, context) => plugin.exportCollectionBibTeX(context),
			},
		],
	});

	return [itemMenu, toolsMenu, fileMenu, collectionMenu].filter(Boolean);
}

export function unregisterMenus(Zotero, ids) {
	for (const id of ids) Zotero.MenuManager.unregisterMenu(id);
}
