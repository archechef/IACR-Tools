/**
 * Fluent localization for strings produced in code (menus use l10n ids directly).
 */
import { PLUGIN } from "../config.js";

export class L10n {
	#localization = null;

	/** @param {() => any} getWindow Returns a chrome window providing `Localization`. */
	constructor(getWindow) {
		this.getWindow = getWindow;
	}

	/** Full message id for a plugin-local id ("menu-sync" → "iacr-tools-menu-sync"). */
	static id(localId) {
		return `${PLUGIN.l10nPrefix}-${localId}`;
	}

	/** Formats a message synchronously; falls back to the id if it is missing. */
	format(localId, args) {
		this.#localization ??= new (this.getWindow().Localization)([PLUGIN.ftl], true);
		return this.#localization.formatValueSync(L10n.id(localId), args) ?? localId;
	}

	/** Makes the plugin's Fluent file available to a window's DOM. */
	static attach(window) {
		window.MozXULElement.insertFTLIfNeeded(PLUGIN.ftl);
	}

	static detach(window) {
		window.document.querySelector(`link[href="${PLUGIN.ftl}"]`)?.remove();
	}
}
