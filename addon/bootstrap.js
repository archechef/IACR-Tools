/* global Zotero, Services, IOUtils, PathUtils, ChromeUtils, APP_SHUTDOWN */
/**
 * Bootstrap entry points called by Zotero. All logic lives in the bundled
 * script (built from src/), which exposes the plugin as Zotero.__GLOBAL_NAME__.
 */

function install() {}

async function startup({ rootURI }) {
	await Zotero.initializationPromise;
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
}

function uninstall() {}
