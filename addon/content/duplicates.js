/* global document, window */
/**
 * Renders the duplicate report from window.arguments[0] (a DuplicatesView, see
 * src/ui/duplicates.js): its `state`, `format()`, `subscribe()` and the
 * actions merge / link / dismiss / show / linkAll.
 */
(() => {
	const io = window.arguments?.[0];
	if (!io) return;
	const byId = (id) => document.getElementById(id);
	const groups = byId("groups");
	const t = (id, args) => io.format(id, args);

	byId("close").textContent = t("dup-close");
	byId("link-all").textContent = t("dup-link-all");
	byId("empty").textContent = t("dup-none");

	function element(tag, className, text) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	}

	function button(label, onClick, disabled) {
		const node = element("button", "", label);
		node.type = "button";
		node.disabled = disabled;
		node.addEventListener("click", onClick);
		return node;
	}

	function paperRow(paper, { group, clusterIndex, choose }) {
		const row = element("label", "paper");
		if (choose) {
			const radio = element("input");
			radio.type = "radio";
			radio.name = `keep-${group.id}-${clusterIndex}`;
			radio.checked = group.keep[clusterIndex] === paper.id;
			radio.disabled = Boolean(group.result || group.busy);
			radio.addEventListener("change", () => (group.keep[clusterIndex] = paper.id));
			row.append(radio);
		}
		else {
			row.append(element("span"));
		}
		row.append(element("span", "title", paper.title || t("dup-untitled")));
		const meta = [paper.type, paper.venue, paper.year, paper.doi && `DOI ${paper.doi}`,
			paper.eprintId && `ePrint ${paper.eprintId}`, paper.citationKey,
			paper.attachments && t("dup-attachments", { count: paper.attachments })].filter(Boolean);
		row.append(element("span", "meta", meta.join(" · ")));
		if (paper.authors) row.append(element("span", "authors", paper.authors));
		return row;
	}

	function card(group) {
		const node = element("section", `card${group.result ? " done" : ""}`);
		node.dataset.group = group.id;
		const copies = group.clusters.filter((cluster) => cluster.length > 1).length;
		const versions = group.clusters.length > 1;
		const head = element("div", "card-head");
		if (copies) head.append(element("span", "badge copies", t("dup-copies")));
		if (versions) head.append(element("span", "badge versions", t("dup-versions")));
		if (versions && group.linked) head.append(element("span", "badge linked", t("dup-linked-badge")));
		head.append(element("span", "spacer"), button(t("dup-show"), () => io.show(group.id), false));
		node.append(head);

		for (const [clusterIndex, cluster] of group.clusters.entries()) {
			const choose = cluster.length > 1;
			const box = element("div", `cluster${choose ? " copies" : ""}`);
			if (choose) box.append(element("span", "cluster-label", t("dup-keep-which", { count: cluster.length })));
			for (const paper of cluster) box.append(paperRow(paper, { group, clusterIndex, choose }));
			if (choose && !group.result) {
				const actions = element("div", "actions");
				actions.append(button(t("dup-merge", { count: cluster.length }),
					() => io.merge(group.id, clusterIndex, group.keep[clusterIndex]), Boolean(group.busy)));
				box.append(actions);
			}
			node.append(box);
		}

		const actions = element("div", "actions");
		if (group.result) {
			actions.append(element("span", `result${group.result.error ? " error" : ""}`, group.result.text));
		}
		else {
			// The preprint can be merged into a published version; with several, the user picks one.
			if (group.mergeTargets?.length) {
				if (group.mergeTargets.length > 1) {
					const label = element("label", "merge-target", t("dup-merge-into"));
					const select = element("select");
					select.disabled = Boolean(group.busy);
					for (const target of group.mergeTargets) {
						const option = element("option", "", target.label);
						option.value = String(target.id);
						option.selected = target.id === group.mergeTarget;
						select.append(option);
					}
					select.addEventListener("change", () => (group.mergeTarget = Number(select.value)));
					label.append(select);
					actions.append(label);
				}
				actions.append(button(t("dup-merge-versions"), () => io.mergeVersions(group.id, group.mergeTarget), Boolean(group.busy)));
			}
			if (versions && !group.linked) actions.append(button(t("dup-link"), () => io.link(group.id), Boolean(group.busy)));
			actions.append(button(t("dup-dismiss"), () => io.dismiss(group.id), Boolean(group.busy)));
			if (group.note) actions.append(element("span", "result", group.note));
		}
		node.append(actions);
		return node;
	}

	function renderHeader(state) {
		document.title = state.headline;
		byId("headline").textContent = state.headline;
		byId("status").textContent = state.status;
		const open = state.groups.filter((group) => !group.result && !group.linked && group.clusters.length > 1);
		byId("link-all").hidden = !open.length;
		byId("link-all").disabled = state.groups.some((group) => group.busy);
		byId("empty").hidden = state.groups.length > 0;
	}

	/** @param {any} state @param {{ group?: string }} [change] */
	function render(state, change) {
		renderHeader(state);
		if (change?.group) {
			const group = state.groups.find((g) => g.id === change.group);
			const old = groups.querySelector(`[data-group="${CSS.escape(change.group)}"]`);
			if (group && old) old.replaceWith(card(group));
			return;
		}
		const scroll = groups.scrollTop;
		groups.replaceChildren(...state.groups.map(card));
		groups.scrollTop = scroll;
	}

	render(io.state);
	const unsubscribe = io.subscribe(render);
	window.addEventListener("unload", unsubscribe);
	byId("link-all").addEventListener("click", () => io.linkAll());
	byId("close").addEventListener("click", () => window.close());
	window.addEventListener("keydown", (event) => {
		if (event.key === "Escape") window.close();
	});
	groups.focus();
})();
