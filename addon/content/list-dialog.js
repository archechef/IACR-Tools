/* global document, window */
/**
 * Fills the paste box from window.arguments[0] and writes the answer back into
 * it: `action` is "add", "file" or "cancel", plus the edited text and the state
 * of the checkbox.
 */
(() => {
	const io = window.arguments?.[0];
	if (!io) return;
	const byId = (id) => document.getElementById(id);
	const text = byId("text");
	const download = byId("download");

	document.title = io.title ?? "";
	byId("description").textContent = io.description ?? "";
	byId("download-label").textContent = io.downloadLabel ?? "";
	byId("accept").textContent = io.acceptLabel ?? "OK";
	byId("file").textContent = io.fileLabel ?? "";
	byId("cancel").textContent = io.cancelLabel ?? "Cancel";
	text.value = io.text ?? "";
	download.checked = Boolean(io.download);

	const finish = (action) => {
		io.action = action;
		io.text = text.value;
		io.download = download.checked;
		window.close();
	};
	byId("accept").addEventListener("click", () => finish("add"));
	byId("file").addEventListener("click", () => finish("file"));
	byId("cancel").addEventListener("click", () => finish("cancel"));
	window.addEventListener("keydown", (event) => {
		if (event.key === "Escape") finish("cancel");
		// Enter accepts from anywhere but the text area, where it starts a new line.
		if (event.key === "Enter" && (event.target !== text || event.metaKey || event.ctrlKey)) finish("add");
	});

	// Tells the caller that the dialog is working; without this it falls back to
	// reading the clipboard.
	io.loaded = true;
	text.focus();
	text.setSelectionRange(text.value.length, text.value.length);
})();
