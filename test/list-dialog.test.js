/**
 * The paste box script (addon/content/list-dialog.js), run against a minimal
 * DOM: which action each key press leads to.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../addon/content/list-dialog.js", import.meta.url), "utf8");

function openDialog(ioOverrides = {}) {
	const element = (localName) => ({ localName, textContent: "", value: "", checked: false, listeners: {},
		addEventListener(type, fn) { this.listeners[type] = fn; }, focus() {}, setSelectionRange() {} });
	const elements = {
		description: element("p"), text: element("textarea"), download: element("input"), "download-label": element("span"),
		accept: element("button"), file: element("button"), cancel: element("button"),
		reorganize: element("input"), "reorganize-label": element("span"), "reorganize-row": element("label"),
	};
	const io = { text: "2008/045", download: true, ...ioOverrides };
	const window = {
		arguments: [io],
		listeners: {},
		addEventListener(type, fn) { this.listeners[type] = fn; },
		close() { this.closed = true; },
	};
	vm.runInNewContext(source, { window, document: { title: "", getElementById: (id) => elements[id] } });
	const press = (key, target, modifiers = {}) => window.listeners.keydown({ key, target, ...modifiers });
	return { io, window, elements, press };
}

test("Enter on a focused button does not add the papers", () => {
	for (const button of ["cancel", "file", "accept"]) {
		const { io, window, elements, press } = openDialog();
		press("Enter", elements[button]);
		assert.equal(window.closed, undefined, `Enter on ${button} is left to the button`);
		assert.equal(io.action, undefined);
	}
});

test("Enter adds the papers from the checkbox, and from the text area only with Ctrl/Cmd", () => {
	const fromCheckbox = openDialog();
	fromCheckbox.press("Enter", fromCheckbox.elements.download);
	assert.equal(fromCheckbox.io.action, "add");

	const plain = openDialog();
	plain.press("Enter", plain.elements.text);
	assert.equal(plain.io.action, undefined, "plain Enter starts a new line");

	const withCtrl = openDialog();
	withCtrl.press("Enter", withCtrl.elements.text, { ctrlKey: true });
	assert.equal(withCtrl.io.action, "add");
	assert.equal(withCtrl.io.text, "2008/045");
});

test("Escape cancels", () => {
	const { io, elements, press } = openDialog();
	press("Escape", elements.text);
	assert.equal(io.action, "cancel");
});

test("the reorganize checkbox shows only for a collection, and its state comes back", () => {
	const inLibrary = openDialog({ reorganize: true });
	assert.equal(inLibrary.elements["reorganize-row"].hidden, true);
	inLibrary.press("Escape", inLibrary.elements.text);
	assert.equal(inLibrary.io.reorganize, false, "never reorganizes without a collection");

	const inCollection = openDialog({ showReorganize: true, reorganize: false, reorganizeLabel: "Move papers" });
	assert.equal(inCollection.elements["reorganize-row"].hidden, false);
	assert.equal(inCollection.elements["reorganize-label"].textContent, "Move papers");
	inCollection.elements.reorganize.checked = true;
	inCollection.press("Enter", inCollection.elements.download);
	assert.equal(inCollection.io.action, "add");
	assert.equal(inCollection.io.reorganize, true);
});
