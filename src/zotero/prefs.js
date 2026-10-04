/**
 * Typed access to the plugin preferences declared in {@link PREFS}.
 */
import { PLUGIN, PREFS } from "../config.js";

/** @typedef {keyof typeof PREFS} PrefName */

export class Prefs {
	/** @type {symbol[]} */
	#observers = [];

	/**
	 * @param {object} deps
	 * @param {any} deps.Zotero
	 * @param {any} deps.Services
	 */
	constructor({ Zotero, Services }) {
		this.Zotero = Zotero;
		this.Services = Services;
	}

	/** Full preference name, e.g. "extensions.iacr-tools.autoConvertSpringer". */
	static fullKey(name) {
		return PLUGIN.prefBranch + PREFS[name].key;
	}

	/** Registers the defaults of {@link PREFS} on the default branch (not persisted). */
	registerDefaults() {
		const branch = this.Services.prefs.getDefaultBranch("");
		for (const name of Object.keys(PREFS)) {
			const key = Prefs.fullKey(name);
			const value = PREFS[name].default;
			if (typeof value === "boolean") branch.setBoolPref(key, value);
			else if (Number.isInteger(value)) branch.setIntPref(key, value);
			else branch.setStringPref(key, String(value));
		}
	}

	/** @param {PrefName} name */
	get(name) {
		const value = this.Zotero.Prefs.get(Prefs.fullKey(name), true);
		return value === undefined ? PREFS[name].default : value;
	}

	/** The Extra-field key under which ePrint ids are stored ("IACR ePrint" by default). */
	eprintKey() {
		return String(this.get("eprintExtraKey"));
	}

	/** @param {PrefName} name */
	set(name, value) {
		this.Zotero.Prefs.set(Prefs.fullKey(name), value, true);
	}

	/** @param {PrefName} name @param {(value: any) => void} handler */
	observe(name, handler) {
		this.#observers.push(this.Zotero.Prefs.registerObserver(Prefs.fullKey(name), handler, true));
	}

	dispose() {
		for (const symbol of this.#observers) this.Zotero.Prefs.unregisterObserver(symbol);
		this.#observers = [];
	}
}
