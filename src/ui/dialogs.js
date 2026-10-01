/**
 * Native dialogs: folder picker, confirmation with a checkbox, alert.
 */

/**
 * @typedef {object} Dialogs
 * @property {(window: any, title: string) => Promise<string | null>} pickFolder
 * @property {(window: any, title: string, filter?: string) => Promise<string | null>} pickFile
 * @property {(window: any, options: { title: string, text: string, accept: string, secondary?: string, checkLabel?: string, checked?: boolean }) => { confirmed: boolean, secondary: boolean, checked: boolean }} confirm
 * @property {(window: any, url: string, io: any) => any} pasteList
 * @property {(window: any, title: string, text: string) => void} alert
 */

/**
 * @param {object} deps
 * @param {any} deps.ChromeUtils
 * @param {any} deps.Services
 * @returns {Dialogs}
 */
export function createDialogs({ ChromeUtils, Services }) {
	return {
		async pickFolder(window, title) {
			const { FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
			const picker = new FilePicker();
			picker.init(window, title, picker.modeGetFolder);
			return (await picker.show()) === picker.returnOK ? picker.file : null;
		},
		async pickFile(window, title, filter) {
			const { FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
			const picker = new FilePicker();
			picker.init(window, title, picker.modeOpen);
			if (filter) picker.appendFilter(filter, filter);
			picker.appendFilters(picker.filterAll);
			return (await picker.show()) === picker.returnOK ? picker.file : null;
		},
		confirm(window, { title, text, accept, secondary, checkLabel, checked = false }) {
			const { prompt } = Services;
			const flags = prompt.BUTTON_POS_0 * prompt.BUTTON_TITLE_IS_STRING
				+ (secondary
					? prompt.BUTTON_POS_1 * prompt.BUTTON_TITLE_IS_STRING + prompt.BUTTON_POS_2 * prompt.BUTTON_TITLE_CANCEL
					: prompt.BUTTON_POS_1 * prompt.BUTTON_TITLE_CANCEL);
			const checkState = { value: checked };
			const button = prompt.confirmEx(window, title, text, flags, accept, secondary ?? null, null, checkLabel ?? null, checkState);
			return { confirmed: button === 0, secondary: Boolean(secondary) && button === 1, checked: checkState.value };
		},
		/**
		 * Opens the paste box and returns its `io` object, with `loaded` telling
		 * the caller whether the dialog really ran.
		 */
		pasteList(window, url, io) {
			window.openDialog(url, "iacr-tools-list", "chrome,dialog,modal,centerscreen,resizable,width=700,height=560", io);
			return io;
		},
		alert(window, title, text) {
			Services.prompt.alert(window, title, text);
		},
	};
}
