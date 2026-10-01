/* global document, window */
/**
 * Renders the progress of a run from window.arguments[0] (a DialogView, see
 * src/ui/progress.js): its `state`, `labels`, `subscribe()` and `requestStop()`.
 * Closing the window does not stop the run; the Stop button does (papers
 * already being fetched are finished).
 */
(() => {
	const io = window.arguments?.[0];
	if (!io) return;
	const byId = (id) => document.getElementById(id);
	const rows = byId("rows");
	const stop = byId("stop");
	const close = byId("close");
	const problemsOnly = byId("problems-only");
	const { labels } = io;

	byId("problems-only-label").textContent = labels.problemsOnly;
	byId("empty").textContent = labels.noProblems;
	close.textContent = labels.close;

	/** Whether the list shows its last row, so that new rows should keep it there. */
	const atBottom = () => rows.scrollHeight - rows.scrollTop - rows.clientHeight < 24;

	function rowElement({ title, status, detail, kind }) {
		const li = document.createElement("li");
		li.className = kind ?? "ok";
		const dot = document.createElement("span");
		dot.className = "dot";
		const name = document.createElement("span");
		name.className = "title";
		name.textContent = title;
		const state = document.createElement("span");
		state.className = "state";
		state.textContent = status;
		li.append(dot, name, state);
		if (detail) {
			const extra = document.createElement("span");
			extra.className = "detail";
			extra.textContent = detail;
			li.append(extra);
		}
		return li;
	}

	function updateEmpty(state) {
		const problems = state.rows.some((row) => row.kind === "error");
		byId("empty").hidden = !(problemsOnly.checked && state.finished && !problems);
	}

	function renderHeader(state) {
		document.title = state.headline;
		byId("headline").textContent = state.headline;
		byId("status").textContent = state.message ? `${state.status} ${state.message}` : state.status;
		const bar = byId("bar");
		if (state.total > 0) {
			bar.max = state.total;
			bar.value = state.finished ? state.total : state.done;
			byId("count").textContent = `${state.done} / ${state.total}`;
		}
		else if (state.finished) {
			bar.max = 1;
			bar.value = 1;
		}
		else {
			bar.removeAttribute("value");
		}
		stop.hidden = state.finished;
		stop.disabled = state.stopRequested;
		stop.textContent = state.stopRequested ? labels.stopping : labels.stop;
		document.body.classList.toggle("finished", state.finished);
		updateEmpty(state);
	}

	/** @param {any} state @param {{ row?: any }} [change] */
	function render(state, change) {
		if (change?.row) {
			const follow = atBottom();
			rows.append(rowElement(change.row));
			if (follow) rows.scrollTop = rows.scrollHeight;
		}
		renderHeader(state);
		if (state.finished && !change?.row) close.focus();
	}

	rows.replaceChildren(...io.state.rows.map(rowElement));
	renderHeader(io.state);
	rows.scrollTop = rows.scrollHeight;
	const unsubscribe = io.subscribe(render);
	window.addEventListener("unload", unsubscribe);

	problemsOnly.addEventListener("change", () => {
		document.body.classList.toggle("problems-only", problemsOnly.checked);
		updateEmpty(io.state);
	});
	stop.addEventListener("click", () => io.requestStop());
	close.addEventListener("click", () => window.close());
	window.addEventListener("keydown", (event) => {
		if (event.key === "Escape") window.close();
	});
	(io.state.finished ? close : rows).focus();
})();
