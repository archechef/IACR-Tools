import { test } from "node:test";
import assert from "node:assert/strict";

import { DialogView, ListProgress } from "../src/ui/progress.js";

const l10n = { format: (id, args) => (args ? `${id} ${JSON.stringify(args)}` : id) };
const labels = {
	stop: "Stop", stopping: "Stopping…", close: "Close", problemsOnly: "Show only problems", noProblems: "No problems.",
	done: "Done", problems: "Done, with problems", stopped: "Stopped", failed: "Failed",
};

/** A DialogView over a fake parent window; `toasts` collects fallback pop-ups. */
function openView() {
	const opened = [];
	const toasts = [];
	const parentWindow = {
		openDialog(url, name, features, io) {
			const window = { url, features, io, closed: false, close() { this.closed = true; } };
			opened.push(window);
			return window;
		},
	};
	const fallback = () => {
		const toast = { lines: [], open: (h) => (toast.headline = h), status: (t) => toast.lines.push(t), finish: (o) => (toast.outcome = o) };
		toasts.push(toast);
		return toast;
	};
	const view = new DialogView({ parentWindow, labels, fallback });
	return { view, opened, toasts };
}

test("the progress window gets every row, the counts and the outcome", () => {
	const { view, opened, toasts } = openView();
	const progress = new ListProgress(null, l10n, view);
	const [window] = opened;
	assert.match(window.url, /^chrome:\/\/iacr-tools\/content\/progress\.xhtml$/);
	assert.match(window.features, /resizable/);
	assert.equal(window.io, view);

	const seen = [];
	view.subscribe((state, change) => seen.push(change?.row?.title ?? state.status));
	progress.setTotal(3);
	progress.entryDone({ raw: "2008/045" }, { status: "added", item: { itemType: "preprint", getDisplayTitle: () => "Threshold RSA" } });
	progress.entryDone({ raw: "EC:Nobody99" }, { status: "not-found", detail: "EC:Nobody99" });
	progress.entryDone({ raw: "2024/1" }, { status: "exists", item: { itemType: "preprint", getDisplayTitle: () => "Old Paper" } });
	progress.finish();

	const { state } = view;
	assert.deepEqual(state.rows.map((r) => [r.title, r.kind]), [["Threshold RSA", "ok"], ["EC:Nobody99", "error"], ["Old Paper", "minor"]]);
	assert.deepEqual([state.done, state.total, state.finished], [3, 3, true]);
	assert.match(state.status, /list-summary .*"added":1.*"exists":1.*"notFound":1/);
	assert.ok(seen.includes("Threshold RSA") && seen.includes("EC:Nobody99"), "the window is told about each row");
	assert.equal(toasts.length, 0, "no pop-up while the window is open");
});

test("Stop is passed on to the run, and a closed window falls back to a pop-up", () => {
	const { view, opened, toasts } = openView();
	const progress = new ListProgress(null, l10n, view);
	assert.equal(progress.stopRequested, false);
	view.requestStop();
	assert.equal(progress.stopRequested, true);

	opened[0].close();
	progress.finish();
	assert.equal(view.state.message, "progress-stopped");
	assert.equal(toasts.length, 1, "the outcome is shown in a pop-up");
	assert.match(toasts[0].lines[0], /list-summary/);
	view.requestStop();
	assert.equal(view.state.finished, true, "Stop after the end changes nothing");
});

test("a listener that throws (a window gone without unsubscribing) is dropped", () => {
	const { view } = openView();
	let calls = 0;
	view.subscribe(() => {
		calls++;
		throw new Error("dead object");
	});
	view.status("one");
	view.status("two");
	assert.equal(calls, 1);
});
