/* global Zotero, Services, IOUtils, PathUtils, ChromeUtils, Cc, Ci, APP_SHUTDOWN */
/**
 * Bootstrap entry points called by Zotero. All logic lives in the bundled
 * script (built from src/), which exposes the plugin as Zotero.__GLOBAL_NAME__.
 */

/** Registration of content/ as chrome://__CHROME_PACKAGE__/content/ (see PLUGIN.chromePackage). */
let chromeHandle = null;

function install() {}

async function startup({ rootURI }) {
	await Zotero.initializationPromise;
	const aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup);
	chromeHandle = aomStartup.registerChrome(Services.io.newURI(`${rootURI}manifest.json`), [
		["content", "__CHROME_PACKAGE__", "content/"],
	]);
	Services.scriptloader.loadSubScript(`${rootURI}__BUNDLE_PATH__`, {
		Zotero, Services, IOUtils, PathUtils, ChromeUtils, rootURI,
	});
	await Zotero.__GLOBAL_NAME__.startup();
}

function onMainWindowLoad({ window }) {
	Zotero.__GLOBAL_NAME__?.onMainWindowLoad(window);
}

function onMainWindowUnload({ window }) {
	Zotero.__GLOBAL_NAME__?.onMainWindowUnload(window);
}

async function shutdown(data, reason) {
	if (reason === APP_SHUTDOWN) return;
	await Zotero.__GLOBAL_NAME__?.shutdown();
	delete Zotero.__GLOBAL_NAME__;
	chromeHandle?.destruct();
	chromeHandle = null;
}

function uninstall() {}
