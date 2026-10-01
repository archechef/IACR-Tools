/**
 * Bundle entry point, executed by bootstrap.js through loadSubScript. It
 * collects the globals of the bootstrap scope and exposes the plugin instance
 * as Zotero.IACRTools.
 */
/* global Zotero, Services, IOUtils, PathUtils, ChromeUtils, rootURI */
import { PLUGIN } from "./config.js";
import { IACRTools } from "./plugin.js";
import { createDialogs } from "./ui/dialogs.js";

const timers = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");

/** Zotero's own merge (mergeItems.mjs since Zotero 7; Zotero.Items.merge before, now deprecated). */
function mergeItems(master, others) {
	try {
		return ChromeUtils.importESModule("chrome://zotero/content/mergeItems.mjs").mergeItems(master, others);
	}
	catch {
		return Zotero.Items.merge(master, others);
	}
}

Zotero[PLUGIN.globalName] = new IACRTools({
	Zotero, Services, IOUtils, PathUtils, timers, rootURI, mergeItems, dialogs: createDialogs({ ChromeUtils, Services }),
});
