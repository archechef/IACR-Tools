/* global Zotero, document */
// Script of the preference pane: wires the button that is not a plain preference.
(() => {
	const plugin = Zotero.__GLOBAL_NAME__;
	document.getElementById("__L10N_PREFIX__-update-cryptobib")
		?.addEventListener("command", () => plugin?.updateCryptoBib());
})();
