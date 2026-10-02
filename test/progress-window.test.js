/**
 * The progress window script (addon/content/progress.js), run against a
 * minimal DOM and a real DialogView: how the end of a run is shown.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { DialogView } from "../src/ui/progress.js";

const source = readFileSync(new URL("../addon/content/progress.js", import.meta.url), "utf8");
const labels = {
	stop: "Stop", stopping: "Stopping…", close: "Close", problemsOnly: "Show only problems", noProblems: "No problems.",
	done: "Done", problems: "Done, with problems", stopped: "Stopped", failed: "Failed",
};

function element() {
	return {
		textContent: "", hidden: false, value: 0, max: 0, checked: false, disabled: false,
		scrollHeight: 0, scrollTop: 0, clientHeight: 0, children: [],
		addEventListener() {}, focus() {}, removeAttribute() {},
		append(...nodes) { this.children.push(...nodes); },
		replaceChildren(...nodes) { this.children = nodes; },
		classList: { toggle() {} },
	};
}

/** Opens the window on a view; `focused` says whether the window has the focus. */
function openWindow({ focused = false } = {}) {
	const elements = new Map();
	const body = { ...element(), dataset: {} };
	const document = {
		title: "",
		body,
		hasFocus: () => focused,
		createElement: () => element(),
		getElementById: (id) => {
			if (!elements.has(id)) elements.set(id, element());
			return elements.get(id);
		},
	};
	let attention = 0;
	const window = { addEventListener() {}, close() {}, getAttention: () => attention++ };
	const view = new DialogView({
		parentWindow: {
			openDialog: (_url, _name, _features, io) => {
				window.arguments = [io];
				vm.runInNewContext(source, { window, document });
				return { closed: false };
			},
		},
		labels,
		fallback: () => assert.fail("the window is open"),
	});
	view.open("Adding papers from a list");
	return { view, document, byId: document.getElementById, attention: () => attention };
}

const row = (kind) => ({ itemType: "preprint", title: "A paper", status: kind === "error" ? "not found" : "added", kind });

test("a running import shows no outcome", () => {
	const { view, document, byId } = openWindow();
	view.progress(1, 3);
	view.row(row("ok"));
	assert.equal(byId("outcome").hidden, true);
	assert.equal(document.title, "Adding papers from a list");
	assert.equal(document.body.dataset.outcome, "");
});

test("a finished import says it is done, in the badge and the window title, and asks for attention once", () => {
	const { view, document, byId, attention } = openWindow();
	view.row(row("ok"));
	view.finish();
	assert.equal(byId("outcome").hidden, false);
	assert.equal(byId("outcome-label").textContent, "Done");
	assert.equal(byId("outcome-icon").textContent, "✓");
	assert.equal(document.body.dataset.outcome, "done");
	assert.equal(document.title, "✓ Adding papers from a list — Done");
	assert.equal(attention(), 1, "the window flashes when it is in the background");
	view.status("later message");
	assert.equal(attention(), 1, "only once");
});

test("problems, Stop and failures each have their own outcome", () => {
	const problems = openWindow();
	problems.view.row(row("ok"));
	problems.view.row(row("error"));
	problems.view.finish();
	assert.equal(problems.byId("outcome-label").textContent, "Done, with problems");
	assert.equal(problems.document.body.dataset.outcome, "problems");

	const stopped = openWindow();
	stopped.view.requestStop();
	stopped.view.finish({ stopped: true });
	assert.equal(stopped.document.body.dataset.outcome, "stopped");

	const failed = openWindow({ focused: true });
	failed.view.finish({ failed: true, message: "database is locked" });
	assert.equal(failed.document.body.dataset.outcome, "failed");
	assert.equal(failed.byId("outcome-label").textContent, "Failed");
	assert.equal(failed.attention(), 0, "a window in front needs no flashing");
});
