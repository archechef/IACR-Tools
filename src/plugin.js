/**
 * The plugin: wires the services together and connects them to Zotero's UI.
 */
import { ASSETS, BROWSER_DOWNLOAD, chromeURL, LATEX, LIST, NETWORK, PLUGIN, PREFS } from "./config.js";
import { eprintPageURL } from "./core/eprint.js";
import { AutoProcessor } from "./zotero/auto-processor.js";
import { CryptoBibStore } from "./zotero/cryptobib-store.js";
import { createCryptoBibSyncAction } from "./zotero/cryptobib-sync.js";
import { BrowserDownloads } from "./zotero/browser-download.js";
import { DoiPdfAction } from "./zotero/doi-pdf.js";
import { EprintActions, storedEprintId } from "./zotero/eprint.js";
import { FolderImporter } from "./zotero/folder-import.js";
import { ListImporter } from "./zotero/list-import.js";
import { collectionAsList, itemsAsList } from "./zotero/list-export.js";
import { parseList } from "./core/list.js";
import { cryptoBibSource, dblpSource, EprintFinder, iacrSearchSource } from "./zotero/eprint-sources.js";
import { ItemWrapper } from "./zotero/item.js";
import { DuplicateFinder } from "./zotero/duplicates.js";
import { LatexSupport } from "./zotero/latex.js";
import { LibraryIndex } from "./zotero/library-index.js";
import { createVersionActions } from "./zotero/versions.js";
import { Pipeline } from "./zotero/pipeline.js";
import { createGeckoFileStore, createLinkMaker, createZoteroHttp } from "./zotero/platform.js";
import { ProjectFolders } from "./zotero/project-folder.js";
import { Prefs } from "./zotero/prefs.js";
import { convertSpringerAction } from "./zotero/springer.js";
import { ZotMoovFiles } from "./zotero/zotmoov.js";
import { registerEprintColumn, unregisterEprintColumn } from "./ui/column.js";
import { L10n } from "./ui/l10n.js";
import { registerMenus, unregisterMenus } from "./ui/menus.js";
import { DuplicatesView } from "./ui/duplicates.js";
import { BatchProgress, BrowserDownloadProgress, DialogView, FolderImportProgress, ListProgress, ToastView } from "./ui/progress.js";
import { resolveImportTarget } from "./ui/target.js";

/**
 * Menu commands: which actions each one runs, in order. The id doubles as the
 * suffix of its Fluent ids ("menu-<id>", "progress-<id>").
 */
export const COMMANDS = Object.freeze([
	{ id: "convert-springer", actions: ["convert"] },
	{ id: "sync-cryptobib", actions: ["sync"] },
	{ id: "find-eprint", actions: ["findEprint"] },
	{ id: "download-eprint", actions: ["downloadEprint"] },
	// The ePrint lookup first, so that papers with an ePrint version are recognized (and recorded).
	{ id: "download-doi-pdf", actions: ["findEprint", "downloadViaDoi"] },
	{ id: "check-eprint-revisions", actions: ["checkEprintRevision"] },
	{ id: "upgrade-preprints", actions: ["upgradePreprint"] },
	{ id: "link-versions", actions: ["linkVersions"] },
	{ id: "process-all", actions: ["convert", "upgradePreprint", "sync", "findEprint", "linkVersions"] },
]);

/**
 * Preference that enables each action for newly added items.
 * @type {ReadonlyArray<{ pref: import("./zotero/prefs.js").PrefName, action: string }>}
 */
const AUTO_ACTIONS = Object.freeze([
	{ pref: "autoConvertSpringer", action: "convert" },
	{ pref: "autoUpgradePreprints", action: "upgradePreprint" },
	{ pref: "autoSyncCryptoBib", action: "sync" },
	{ pref: "autoFindEprint", action: "findEprint" },
	{ pref: "autoDownloadEprint", action: "downloadEprint" },
	{ pref: "autoDownloadViaDoi", action: "downloadViaDoi" },
	{ pref: "autoLinkVersions", action: "linkVersions" },
]);

export class IACRTools {
	#menuIDs = [];
	#columnKey = null;

	/**
	 * @param {object} env Globals of the bootstrap scope.
	 * @param {any} env.Zotero
	 * @param {any} env.Services
	 * @param {any} env.IOUtils
	 * @param {any} env.PathUtils
	 * @param {{ setTimeout: Function, clearTimeout: Function }} env.timers
	 * @param {string} env.rootURI
	 * @param {import("./ui/dialogs.js").Dialogs} env.dialogs
	 * @param {(master: any, others: any[]) => Promise<void>} [env.mergeItems]  Zotero's item merge.
	 * @param {() => Promise<string>} [env.downloadsDirectory]  The system's Downloads folder.
	 */
	constructor({
		Zotero, Services, IOUtils, PathUtils, timers, rootURI, dialogs,
		mergeItems = (master, others) => Zotero.Items.merge(master, others),
		downloadsDirectory = async () => "",
	}) {
		this.Zotero = Zotero;
		this.downloadsDirectory = downloadsDirectory;
		this.dialogs = dialogs;
		this.rootURI = rootURI;
		this.log = (msg) => Zotero.debug(`${PLUGIN.name}: ${msg}`);
		this.l10n = new L10n(() => Zotero.getMainWindow());
		this.prefs = new Prefs({ Zotero, Services });

		const http = createZoteroHttp(Zotero);
		const files = createGeckoFileStore({ IOUtils, PathUtils, Zotero });
		this.store = new CryptoBibStore({
			http,
			files,
			prefs: this.prefs,
			dataDirectory: Zotero.DataDirectory.dir,
			timers,
			log: this.log,
		});
		const finder = new EprintFinder(() => [
			cryptoBibSource(this.store),
			...(this.prefs.get("useOnlineEprintSearch") ? [dblpSource(http), iacrSearchSource(http)] : []),
		], this.log);
		const eprintKey = () => this.prefs.eprintKey();
		const eprint = new EprintActions({ Zotero, prefs: this.prefs, finder, http, md5: (path) => files.md5(path) });
		const viaDoi = new DoiPdfAction({ Zotero, eprintIdOf: (context) => eprint.eprintIdOf(context), timers });
		const versions = createVersionActions(this.prefs);

		/** @type {Record<string, import("./zotero/pipeline.js").Action>} */
		this.actions = {
			convert: convertSpringerAction,
			sync: createCryptoBibSyncAction(this.prefs),
			findEprint: eprint.find,
			downloadEprint: eprint.download,
			downloadViaDoi: viaDoi.action,
			checkEprintRevision: eprint.checkRevision,
			upgradePreprint: versions.upgrade,
			linkVersions: versions.link,
		};
		this.commands = COMMANDS;
		this.pipeline = new Pipeline({
			Zotero,
			store: this.store,
			log: this.log,
			// The papers only: the version links compare items, never files.
			loadLibrary: (libraryID) => new LibraryIndex({ Zotero, files, eprintKey: eprintKey() }).load(libraryID, { files: false }),
		});
		this.latex = new LatexSupport({ Zotero, store: this.store, eprintKey });
		this.duplicates = new DuplicateFinder({ Zotero, prefs: this.prefs, mergeItems });
		this.autoProcessor = new AutoProcessor({
			Zotero,
			pipeline: this.pipeline,
			enabledActions: () => AUTO_ACTIONS
				.filter(({ pref }) => this.prefs.get(pref))
				.map(({ action }) => this.actions[action]),
			timers,
			log: this.log,
		});
		this.files = files;
		this.listImporter = new ListImporter({
			Zotero,
			http,
			files,
			store: this.store,
			pipeline: this.pipeline,
			finder,
			eprintKey,
			concurrency: () => this.concurrency,
			suspendAutoProcessing: () => this.autoProcessor.suspend(),
			log: this.log,
		});
		this.zotmoov = new ZotMoovFiles({ Zotero, log: this.log });
		this.projectFolders = new ProjectFolders({ Zotero, files, makeLink: createLinkMaker({ Zotero, Services }), log: this.log });
		this.browserDownloads = new BrowserDownloads({ Zotero, files, timers, openURL: (url) => Zotero.launchURL(url), log: this.log });
		this.folderImporter = new FolderImporter({
			Zotero,
			files,
			store: this.store,
			pipeline: this.pipeline,
			eprintKey,
			suspendAutoProcessing: () => this.autoProcessor.suspend(),
			log: this.log,
		});
	}

	async startup() {
		this.prefs.registerDefaults();
		this.prefs.observe("abbrevLevel", () => this.store.invalidate());
		await this.Zotero.PreferencePanes.register({
			pluginID: PLUGIN.id,
			src: ASSETS.preferencePane,
			scripts: [ASSETS.preferenceScript],
			image: ASSETS.icon,
		});
		for (const window of this.Zotero.getMainWindows()) this.onMainWindowLoad(window);
		this.#columnKey = await registerEprintColumn({
			Zotero: this.Zotero,
			label: this.l10n.format("column-eprint"),
			eprintIdOf: (item) => this.eprintIdOf(item) ?? "",
		});
		this.#menuIDs = registerMenus({ Zotero: this.Zotero, rootURI: this.rootURI, plugin: this });
		this.autoProcessor.start();
		this.log("started");
	}

	async shutdown() {
		this.autoProcessor.stop();
		unregisterMenus(this.Zotero, this.#menuIDs);
		await unregisterEprintColumn(this.Zotero, this.#columnKey);
		for (const window of this.Zotero.getMainWindows()) this.onMainWindowUnload(window);
		this.prefs.dispose();
		this.store.dispose();
	}

	onMainWindowLoad(window) {
		L10n.attach(window);
	}

	onMainWindowUnload(window) {
		L10n.detach(window);
	}

	/**
	 * Runs a menu command on the given items, reporting progress.
	 * @param {string} commandId
	 * @param {any[]} items
	 */
	async runCommand(commandId, items) {
		const command = COMMANDS.find((c) => c.id === commandId);
		const progress = this.#openProgress((view) => new BatchProgress(this.Zotero, this.l10n, `progress-${commandId}`, view));
		progress.setTotal(new Set(this.pipeline.eligible(items)).size);
		try {
			await this.#preloadCryptoBib(progress);
			await this.pipeline.run(items, command.actions.map((name) => this.actions[name]), {
				onItemDone: (item, results) => progress.itemDone(item, results),
				concurrency: this.concurrency,
				shouldStop: () => progress.stopRequested,
			});
			progress.finish();
		}
		catch (e) {
			this.log(`${commandId} failed: ${e}`);
			progress.fail(e);
		}
	}

	/**
	 * The progress window of a long run, or Zotero's small pop-up if the window
	 * cannot be opened.
	 * @template {BatchProgress} P
	 * @param {(view: import("./ui/progress.js").ProgressView) => P} create
	 * @returns {P}
	 */
	#openProgress(create) {
		const { Zotero, l10n } = this;
		if (!this.prefs.get("progressWindow")) return create(new ToastView(Zotero));
		try {
			return create(new DialogView({
				parentWindow: Zotero.getMainWindow(),
				labels: {
					stop: l10n.format("progress-stop"),
					stopping: l10n.format("progress-stopping"),
					close: l10n.format("progress-close"),
					problemsOnly: l10n.format("progress-problems-only"),
					noProblems: l10n.format("progress-no-problems"),
					done: l10n.format("progress-outcome-done"),
					problems: l10n.format("progress-outcome-problems"),
					stopped: l10n.format("progress-outcome-stopped"),
					failed: l10n.format("progress-outcome-failed"),
				},
				fallback: () => new ToastView(Zotero),
			}));
		}
		catch (e) {
			this.log(`The progress window could not be opened: ${e}`);
			return create(new ToastView(Zotero));
		}
	}

	/** Papers looked up or downloaded at the same time (preference, within NETWORK.concurrency). */
	get concurrency() {
		const { min, max } = NETWORK.concurrency;
		const value = Number.parseInt(this.prefs.get("concurrency"), 10);
		return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : PREFS.concurrency.default;
	}

	/** Loads CryptoBib up front so that a first-time download is visible to the user. */
	async #preloadCryptoBib(progress) {
		try {
			await this.store.getIndex({ onStatus: (status) => progress.status(`store-${status}`) });
		}
		catch (e) {
			// Actions that need CryptoBib report the failure per item; the others still work.
			this.log(`CryptoBib unavailable: ${e}`);
			progress.status("store-failed");
		}
	}

	/** Downloads the latest CryptoBib export (Tools menu, preferences). */
	async updateCryptoBib() {
		const progress = new BatchProgress(this.Zotero, this.l10n, "progress-update-cryptobib");
		try {
			const index = await this.store.update({ onStatus: (status) => progress.status(`store-${status}`) });
			progress.finish("store-updated", { count: index.size });
		}
		catch (e) {
			this.log(`CryptoBib update failed: ${e}`);
			progress.fail(e);
		}
	}

	/**
	 * File menu / collection context menu: imports the PDFs of a folder (and its
	 * subfolders) into the selected library or collection, skipping papers that
	 * are already in the library.
	 */
	async importFolder(context) {
		const { Zotero, l10n, prefs } = this;
		const { window, libraryID, collection, source } = resolveImportTarget(Zotero, context);
		this.log(`Import target: library ${libraryID}, collection ${collection ? `"${collection.name}" (${collection.id})` : "none"} (from ${source})`);
		const title = l10n.format("import-title");
		if (!Zotero.Libraries.isEditable(libraryID)) {
			this.dialogs.alert(window, title, l10n.format("import-read-only"));
			return;
		}
		const folder = await this.dialogs.pickFolder(window, l10n.format("import-pick-folder"));
		if (!folder) return;

		const scanProgress = new BatchProgress(Zotero, l10n, "progress-import-folder");
		scanProgress.status("import-scanning");
		let plan;
		try {
			plan = await this.folderImporter.scan(folder, libraryID);
		}
		catch (e) {
			this.log(`Scanning ${folder} failed: ${e}`);
			scanProgress.fail(e);
			return;
		}
		scanProgress.close();

		const count = (status) => plan.files.filter((file) => file.status === status).length;
		const counts = { total: plan.files.length, new: count("new"), exists: count("exists"), repeat: count("repeat") };
		if (!counts.new) {
			this.dialogs.alert(window, title, l10n.format("import-nothing-new", { ...counts, folder: plan.folderName }));
			return;
		}
		const target = collection?.name ?? Zotero.Libraries.get(libraryID)?.name ?? "";
		const answer = this.dialogs.confirm(window, {
			title,
			text: l10n.format("import-confirm", { ...counts, folder: plan.folderName, target }),
			accept: l10n.format("import-accept"),
			checkLabel: l10n.format("import-find-eprint"),
			checked: Boolean(prefs.get("folderImportFindEprint")),
		});
		if (!answer.confirmed) return;
		prefs.set("folderImportFindEprint", answer.checked);

		const eprintAction = prefs.get("folderImportDownloadEprint") ? this.actions.downloadEprint : this.actions.findEprint;
		const progress = this.#openProgress((view) => new FolderImportProgress(Zotero, l10n, view));
		progress.setTotal(plan.files.length);
		try {
			await this.#preloadCryptoBib(progress);
			progress.status("import-running", { count: counts.new });
			await this.folderImporter.run(plan, {
				collectionID: collection?.id ?? null,
				subcollections: Boolean(prefs.get("folderImportSubcollections")),
				link: Boolean(prefs.get("folderImportLinkFiles")),
				attachToExisting: Boolean(prefs.get("folderImportAttachToExisting")),
				metadataActions: [
					...(prefs.get("autoConvertSpringer") ? [this.actions.convert] : []),
					...(prefs.get("autoSyncCryptoBib") ? [this.actions.sync] : []),
				],
				eprintActions: answer.checked ? [eprintAction] : [],
			}, { onFileDone: (file, result) => progress.fileDone(file, result), shouldStop: () => progress.stopRequested });
			progress.finish();
		}
		catch (e) {
			this.log(`Folder import failed: ${e}`);
			progress.fail(e);
		}
	}

	/**
	 * File menu / collection context menu: adds the papers of a reading list —
	 * pasted into the plugin's own box, or read from a file — and downloads
	 * their ePrint PDFs. Sections of the list ("[Topic]") go into
	 * subcollections; optionally, papers already in the collection are moved
	 * into the subcollections the list names, and ZotMoov moves their files.
	 */
	async addPapersFromList(context) {
		const { Zotero, l10n, prefs } = this;
		const { window, libraryID, collection, source } = resolveImportTarget(Zotero, context);
		const title = l10n.format("list-title");
		if (!Zotero.Libraries.isEditable(libraryID)) {
			this.dialogs.alert(window, title, l10n.format("import-read-only"));
			return;
		}
		this.log(`List target: library ${libraryID}, collection ${collection ? `"${collection.name}"` : "none"} (from ${source})`);
		const target = collection?.name ?? Zotero.Libraries.get(libraryID)?.name ?? "";

		const list = await this.#collectList(window, title, target, Boolean(collection));
		if (!list) return;
		prefs.set("listDownloadPdf", list.download);
		if (collection) prefs.set("listReorganize", list.reorganize);

		const progress = this.#openProgress((view) => new ListProgress(Zotero, l10n, view));
		progress.setTotal(list.entries.length);
		try {
			await this.#preloadCryptoBib(progress);
			progress.status("list-running", { count: list.entries.length });
			const summary = await this.listImporter.run(list.entries, {
				libraryID,
				collectionID: collection?.id ?? null,
				reorganize: Boolean(collection) && list.reorganize,
				metadataActions: prefs.get("autoSyncCryptoBib") ? [this.actions.sync] : [],
				eprintActions: list.download
					? [this.actions.downloadEprint, ...(prefs.get("listDownloadViaDoi") ? [this.actions.downloadViaDoi] : [])]
					: [this.actions.findEprint],
			}, { onEntryDone: (entry, result) => progress.entryDone(entry, result), shouldStop: () => progress.stopRequested });
			await this.#moveRefiledFiles(summary, progress);
			progress.finish();
		}
		catch (e) {
			this.log(`Adding papers from a list failed: ${e}`);
			progress.fail(e);
		}
	}

	/** Papers the list import moved between collections: ZotMoov moves their files along. */
	async #moveRefiledFiles(summary, progress) {
		const papers = summary.filter(({ result }) => result.refiledTo)
			.map(({ result }) => ({ item: result.item, collectionID: result.refiledTo }));
		if (!papers.length || !this.prefs.get("listMoveFilesWithZotMoov") || !this.zotmoov.available) return;
		progress.status("list-moving-files", { count: papers.length });
		const moved = await this.zotmoov.moveFiles(papers);
		this.log(`ZotMoov moved ${moved} files of ${papers.length} papers`);
	}

	/**
	 * The paste box: pre-filled from the clipboard, with "Use a File Instead…"
	 * loading a list from disk. Falls back to clipboard plus a confirmation
	 * when the box cannot be opened.
	 * @param {boolean} inCollection  Whether the list goes into a collection (which can be reorganized).
	 * @returns {Promise<{ entries: import("./core/list.js").ListEntry[], download: boolean, reorganize: boolean } | null>}
	 */
	async #collectList(window, title, target, inCollection) {
		const { l10n, prefs } = this;
		const clipboard = this.#clipboardText();
		let text = parseList(clipboard).length ? clipboard : "";
		let download = Boolean(prefs.get("listDownloadPdf"));
		let reorganize = inCollection && Boolean(prefs.get("listReorganize"));

		for (let round = 0; round < 8; round++) {
			let answer;
			try {
				answer = this.dialogs.pasteList(window, chromeURL(ASSETS.listDialog), {
					title,
					description: l10n.format("list-dialog-description", { target }),
					acceptLabel: l10n.format("list-accept"),
					fileLabel: l10n.format("list-choose-file"),
					cancelLabel: l10n.format("list-cancel"),
					downloadLabel: l10n.format("list-download-pdf"),
					reorganizeLabel: l10n.format("list-reorganize", { target }),
					showReorganize: inCollection,
					text,
					download,
					reorganize,
					action: "cancel",
					loaded: false,
				});
			}
			catch (e) {
				this.log(`The paste box could not be opened: ${e}`);
			}
			if (!answer?.loaded) return this.#collectListFromClipboard(window, title, target, clipboard, download);

			text = answer.text ?? "";
			download = Boolean(answer.download);
			reorganize = inCollection && Boolean(answer.reorganize);
			if (answer.action === "cancel") return null;
			if (answer.action === "file") {
				const path = await this.dialogs.pickFile(window, l10n.format("list-pick-file"), LIST.fileFilter);
				if (path) text = await this.files.readText(path).catch(() => "");
				continue;
			}
			const entries = parseList(text);
			if (entries.length) return { entries, download, reorganize };
			this.dialogs.alert(window, title, l10n.format("list-empty"));
		}
		return null;
	}

	/** Without the paste box: the clipboard (or a file) and a plain confirmation; nothing is reorganized. */
	async #collectListFromClipboard(window, title, target, clipboard, download) {
		const { l10n } = this;
		let entries = parseList(clipboard);
		const ask = (secondary) => this.dialogs.confirm(window, {
			title,
			text: l10n.format("list-confirm", { count: entries.length, target }),
			accept: l10n.format("list-accept"),
			secondary,
			checkLabel: l10n.format("list-download-pdf"),
			checked: download,
		});
		let answer = entries.length ? ask(l10n.format("list-choose-file")) : { confirmed: false, secondary: true, checked: download };
		if (!answer.confirmed && !answer.secondary) return null;
		if (answer.secondary) {
			const path = await this.dialogs.pickFile(window, l10n.format("list-pick-file"), LIST.fileFilter);
			if (!path) return null;
			entries = parseList(await this.files.readText(path).catch(() => ""));
			if (!entries.length) {
				this.dialogs.alert(window, title, l10n.format("list-empty"));
				return null;
			}
			answer = ask(undefined);
			if (!answer.confirmed) return null;
		}
		return { entries, download: answer.checked, reorganize: false };
	}

	/**
	 * Collection menu: links a project folder on disk to the collection. Its
	 * refs/papers shows the folder ZotMoov files the collection's PDFs in, and
	 * Better BibTeX keeps refs/references.bib updated with its papers. Says
	 * what it will do and asks first; leaves alone what is already there.
	 */
	async linkProjectFolder(context) {
		const { Zotero, l10n } = this;
		const { window, collection } = resolveImportTarget(Zotero, context);
		const title = l10n.format("project-title");
		if (!collection) {
			this.dialogs.alert(window, title, l10n.format("project-no-collection"));
			return null;
		}
		const folder = await this.dialogs.pickFolder(window, l10n.format("project-pick-folder", { name: collection.name }));
		if (!folder) return null;
		let plan;
		try {
			plan = await this.projectFolders.plan(collection, folder);
		}
		catch (e) {
			this.log(`Looking at the project folder ${folder} failed: ${e}\n${e.stack ?? ""}`);
			this.dialogs.alert(window, title, String(e?.message ?? e));
			return null;
		}
		const name = collection.name;
		const lines = [this.#papersLine(plan.papers, name), this.#bibliographyLine(plan.bibliography, name)];
		if (plan.papers.state !== "create" && plan.bibliography.state !== "create") {
			this.dialogs.alert(window, title, [l10n.format("project-nothing-to-do", { folder, name }), ...lines].join("\n\n"));
			return { plan, outcome: null };
		}
		const folderName = this.files.basename(folder);
		const answer = this.dialogs.confirm(window, {
			title,
			text: [
				l10n.format("project-confirm", { folder, name }),
				...lines,
				...(folderName.trim().toLowerCase() === name.trim().toLowerCase() ? [] : [l10n.format("project-name-differs", { folder: folderName, name })]),
			].join("\n\n"),
			accept: l10n.format("project-accept"),
		});
		if (!answer.confirmed) return null;
		const outcome = await this.projectFolders.apply(plan);
		const report = (kind, result, args) => (result.state === "created"
			? l10n.format(`project-${kind}-created`, args)
			: l10n.format(`project-${kind}-failed`, { ...args, error: result.error ?? "" }));
		this.dialogs.alert(window, title, [
			...(outcome.papers.state === "unchanged" ? [] : [report("papers", outcome.papers, { link: plan.papers.link, target: plan.papers.target ?? "" })]),
			...(outcome.bibliography.state === "unchanged" ? [] : [report("bib", outcome.bibliography, { path: plan.bibliography.path, name })]),
		].join("\n\n"));
		return { plan, outcome };
	}

	/** @param {import("./zotero/project-folder.js").PapersPlan} papers */
	#papersLine({ link, target, state, reason, replacesEmptyFolder }, name) {
		const { l10n } = this;
		if (state === "unavailable") return l10n.format("project-papers-unavailable", { reason: l10n.format(`project-${reason}`) });
		const args = { link, target: target ?? "", name };
		if (state === "create") return l10n.format(replacesEmptyFolder ? "project-papers-replace" : "project-papers-create", args);
		return l10n.format(`project-papers-${state}`, args);
	}

	/** @param {import("./zotero/project-folder.js").BibliographyPlan} bibliography */
	#bibliographyLine({ path, state, replacesFile }, name) {
		const id = state === "create" && replacesFile ? "project-bib-replace" : `project-bib-${state}`;
		return this.l10n.format(id, { path, name });
	}

	/**
	 * Item / collection context menu: copies the papers to the clipboard as a
	 * list, in the format the list import reads back.
	 * @param {any[]} items
	 * @param {string} [sourceName] Where the papers come from, for the header line.
	 */
	copyAsList(items, sourceName) {
		const text = itemsAsList(this.Zotero, items ?? [], {
			eprintKey: this.prefs.eprintKey(),
			header: this.l10n.format("copy-header", { source: sourceName ?? "" }),
		});
		return this.#copyList(text, text.split("\n").filter((line) => line && !line.startsWith("#")).length);
	}

	/** Puts a list on the clipboard and says how many papers it holds. */
	#copyList(text, count) {
		const { Zotero, l10n } = this;
		if (!count) {
			this.dialogs.alert(Zotero.getMainWindow(), l10n.format("copy-title"), l10n.format("copy-empty"));
			return 0;
		}
		Zotero.Utilities.Internal.copyTextToClipboard(text);
		this.log(`Copied ${count} papers to the clipboard`);
		new BatchProgress(Zotero, l10n, "progress-copy-list").finish("copy-summary", { count });
		return count;
	}

	/**
	 * The same, for a collection: its subcollections become sections
	 * ("[Topic]"), so the list can be imported back with its structure. For a
	 * library, every paper in one list.
	 */
	async copyCollectionAsList(context) {
		const { collection } = resolveImportTarget(this.Zotero, context);
		if (!collection) {
			const { items, name } = await this.collectionPapers(context);
			return this.copyAsList(items, name);
		}
		const { text, count } = collectionAsList(this.Zotero, collection, {
			subcollections: Boolean(this.prefs.get("collectionsIncludeSubcollections")),
			eprintKey: this.prefs.eprintKey(),
			header: this.l10n.format("copy-header", { source: collection.name }),
		});
		return this.#copyList(text, count);
	}

	/**
	 * The papers a collection menu command applies to: those of the collection
	 * and, by default, of all its subcollections (the plugin's own preference:
	 * Zotero's View → Show Items from Subcollections is a display choice and off
	 * by default, which left subcollections out unnoticed), or of the whole
	 * library when a library was right-clicked. Every collection command (paper
	 * commands, LaTeX, BibTeX export, duplicates) goes through here.
	 * @returns {Promise<{ items: any[], name: string, isLibrary: boolean, window: any }>}
	 */
	async collectionPapers(context) {
		const { Zotero } = this;
		const { window, libraryID, collection } = resolveImportTarget(Zotero, context);
		const regular = (items) => items.filter((item) => item?.isRegularItem?.() && !item.deleted);
		if (!collection) {
			const items = regular(await Zotero.Items.getAll(libraryID, true, false));
			return { items, name: Zotero.Libraries.get(libraryID)?.name ?? "", isLibrary: true, window };
		}
		const recursive = Boolean(this.prefs.get("collectionsIncludeSubcollections"));
		const ids = new Set();
		const visit = (current) => {
			for (const id of current.getChildItems(true)) ids.add(id);
			if (recursive) for (const child of current.getChildCollections(false)) visit(child);
		};
		visit(collection);
		return { items: regular(Zotero.Items.get([...ids])), name: collection.name, isLibrary: false, window };
	}

	/**
	 * Collection menu: runs a menu command on the collection's papers, or, for
	 * a library, on all of its papers after a confirmation.
	 * @param {string} commandId
	 */
	async runCollectionCommand(commandId, context) {
		const { l10n } = this;
		const { items, name, isLibrary, window } = await this.collectionPapers(context);
		if (!items.length) {
			this.dialogs.alert(window, l10n.format(`progress-${commandId}`), l10n.format("collection-empty", { name }));
			return null;
		}
		if (isLibrary) {
			const answer = this.dialogs.confirm(window, {
				title: l10n.format(`progress-${commandId}`),
				text: l10n.format("collection-confirm-library", { action: l10n.format(`progress-${commandId}`), count: items.length, name }),
				accept: l10n.format("collection-run"),
			});
			if (!answer.confirmed) return null;
		}
		return this.runCommand(commandId, items);
	}

	/** Collection menu: a \cite command for the collection's papers. */
	async copyCollectionLatexCitation(context) {
		return this.copyLatexCitation((await this.collectionPapers(context)).items);
	}

	/**
	 * Item context menu: copies a \cite command for the selected papers, with
	 * CryptoBib keys for the papers CryptoBib has.
	 * @param {any[]} items
	 */
	async copyLatexCitation(items) {
		const { Zotero, l10n } = this;
		const title = l10n.format("latex-title");
		try {
			const cite = await this.latex.citeCommand(items ?? []);
			if (!cite.keys) {
				this.dialogs.alert(Zotero.getMainWindow(), title, l10n.format("latex-no-keys"));
				return null;
			}
			Zotero.Utilities.Internal.copyTextToClipboard(cite.text);
			this.log(`Copied ${cite.text}`);
			const progress = new BatchProgress(Zotero, l10n, "progress-copy-latex");
			progress.finish("latex-copied", { count: cite.keys, others: cite.notInCryptoBib, missing: cite.withoutKey });
			return cite;
		}
		catch (e) {
			this.log(`Copying the LaTeX citation failed: ${e}`);
			this.dialogs.alert(Zotero.getMainWindow(), title, String(e?.message ?? e));
			return null;
		}
	}

	/**
	 * Item / collection context menu: saves the papers that CryptoBib lacks as
	 * a BibTeX file, to be used next to crypto.bib.
	 * @param {any[]} items
	 * @param {string} [sourceName] Collection name, for the default file name.
	 */
	async exportBibTeXNotInCryptoBib(items, sourceName) {
		const { Zotero, l10n, prefs } = this;
		const window = Zotero.getMainWindow();
		const title = l10n.format("latex-export-title");
		try {
			const fileName = LATEX.fileName(sourceName?.replace(/[\\/:*?"<>|]+/g, "-").trim());
			const header = l10n.format("latex-export-header", {
				date: new Date().toISOString().slice(0, 10),
				abbrev: `abbrev${prefs.get("abbrevLevel")}`,
				file: fileName.replace(/\.bib$/, ""),
			});
			const result = await this.latex.bibliographyNotInCryptoBib(items ?? [], { header });
			if (!result.exported) {
				this.dialogs.alert(window, title, l10n.format("latex-export-nothing", { count: result.inCryptoBib }));
				return null;
			}
			const path = await this.dialogs.pickSaveFile(window, title, fileName, LATEX.fileFilter);
			if (!path) return null;
			await this.files.writeText(path, result.text);
			this.log(`Exported ${result.exported} papers to ${path}`);
			new BatchProgress(Zotero, l10n, "progress-export-bibtex")
				.finish("latex-exported", { count: result.exported, inCryptoBib: result.inCryptoBib });
			return path;
		}
		catch (e) {
			this.log(`The BibTeX export failed: ${e}`);
			this.dialogs.alert(window, title, String(e?.message ?? e));
			return null;
		}
	}

	/** The same, for every paper in a collection. */
	async exportCollectionBibTeX(context) {
		const { items, name } = await this.collectionPapers(context);
		return this.exportBibTeXNotInCryptoBib(items, name);
	}

	/**
	 * Tools menu (whole library), collection menu (groups touching the
	 * collection) and item menu (groups touching the selection): opens the
	 * report of papers that are probably the same paper.
	 * @param {{ context?: any, items?: any[] }} [source]
	 */
	async findDuplicates({ context, items } = {}) {
		const { Zotero, l10n } = this;
		const title = l10n.format("dup-title");
		const target = resolveImportTarget(Zotero, context);
		const selected = (items ?? []).filter((item) => item?.isRegularItem?.());
		let libraryID = target.libraryID;
		let scope = null;
		let where = Zotero.Libraries.get(libraryID)?.name ?? "";
		if (selected.length) {
			libraryID = selected[0].libraryID;
			scope = new Set(selected.map((item) => item.id));
			where = l10n.format("dup-selection", { count: selected.length });
		}
		else if (context && target.collection) {
			const papers = await this.collectionPapers(context);
			scope = new Set(papers.items.map((item) => item.id));
			where = papers.name;
		}
		const progress = new BatchProgress(Zotero, l10n, "progress-find-duplicates");
		progress.status("dup-scanning");
		let report;
		try {
			report = await this.duplicates.find(libraryID, { scope });
		}
		catch (e) {
			this.log(`Looking for duplicates failed: ${e}\n${e.stack ?? ""}`);
			progress.fail(e);
			return null;
		}
		progress.close();
		if (!report.groups.length) {
			this.dialogs.alert(target.window, title, l10n.format("dup-nothing", { papers: report.papers }));
			return report;
		}
		const view = new DuplicatesView({ Zotero, l10n, finder: this.duplicates, log: this.log });
		try {
			view.open(target.window ?? Zotero.getMainWindow(), report, where);
		}
		catch (e) {
			this.log(`The duplicate report could not be opened: ${e}`);
			this.dialogs.alert(target.window, title, l10n.format("dup-no-window", { groups: report.groups.length }));
		}
		return view;
	}

	/**
	 * IACR → ePrint & PDFs → Download Missing PDFs in Browser…: for papers
	 * without a PDF that have an ePrint version or a DOI, opens their PDF links
	 * in the user's browser and attaches the PDFs saved to the Downloads folder
	 * while the progress window is open. For eprint.iacr.org and publishers such
	 * as ACM, whose sites only let browsers download PDFs.
	 * @param {any[]} items
	 */
	async downloadInBrowser(items) {
		const { Zotero, l10n, prefs } = this;
		const window = Zotero.getMainWindow();
		const title = l10n.format("browser-title");
		const papers = this.papersMissingPdf(items ?? []);
		if (!papers.length) {
			this.dialogs.alert(window, title, l10n.format("browser-nothing"));
			return null;
		}
		const folder = await this.#browserDownloadFolder();
		if (!folder) {
			this.dialogs.alert(window, title, l10n.format("browser-no-folder", { folder: String(prefs.get("browserDownloadFolder") || "").trim() || "none" }));
			return null;
		}
		const answer = this.dialogs.confirm(window, {
			title,
			text: l10n.format("browser-confirm", { count: papers.length, folder, tabs: BROWSER_DOWNLOAD.maxOpen }),
			accept: l10n.format("browser-accept"),
		});
		if (!answer.confirmed) return null;

		const progress = this.#openProgress((view) => new BrowserDownloadProgress(Zotero, l10n, view));
		progress.setTotal(papers.length);
		try {
			const outcome = await this.browserDownloads.run(papers, folder, {
				onAttached: (paper, fileName) => progress.attached(paper.item, fileName),
				onUnmatched: (fileName) => progress.unmatched(fileName),
				onFailed: (paper, error) => progress.failed(paper.item, error),
				onWaiting: (count) => progress.status("browser-waiting", { count, folder }),
				shouldStop: () => progress.stopRequested,
			});
			for (const paper of outcome.missing) progress.missing(paper.item);
			progress.finish();
			return outcome;
		}
		catch (e) {
			this.log(`Downloading in the browser failed: ${e}\n${e.stack ?? ""}`);
			progress.fail(e);
			return null;
		}
	}

	/**
	 * Papers without a PDF that have an ePrint version (its PDF is fetched from
	 * eprint.iacr.org) or else a DOI.
	 * @param {any[]} items
	 * @returns {import("./zotero/browser-download.js").BrowserPaper[]}
	 */
	papersMissingPdf(items) {
		const papers = [];
		for (const item of items) {
			if (!item?.isRegularItem?.() || item.deleted) continue;
			const wrapper = new ItemWrapper(item, this.Zotero);
			if (wrapper.hasPDF({ epub: true })) continue;
			const doi = wrapper.doi ?? "";
			const eprintId = this.eprintIdOf(item) ?? undefined;
			if (!doi && !eprintId) continue;
			papers.push({ item, doi, eprintId, title: wrapper.getField("title") });
		}
		return papers;
	}

	/** The folder the browser saves to: the preference, else the system's Downloads folder; null if missing. */
	async #browserDownloadFolder() {
		let folder = String(this.prefs.get("browserDownloadFolder") || "").trim();
		try {
			folder ||= await this.downloadsDirectory();
			return folder && (await this.files.exists(folder)) ? folder : null;
		}
		catch (e) {
			this.log(`No Downloads folder: ${e}`);
			return null;
		}
	}

	/** The clipboard as text, if it holds any. */
	#clipboardText() {
		const internal = this.Zotero.Utilities?.Internal;
		for (const flavor of ["text/plain", "text/unicode"]) {
			try {
				const text = internal?.getClipboard?.(flavor);
				if (text) return text;
			}
			catch (e) {
				this.log(`Cannot read the clipboard (${flavor}): ${e}`);
			}
		}
		return "";
	}

	/** @returns {string | null} */
	eprintIdOf(item) {
		return storedEprintId(new ItemWrapper(item, this.Zotero), this.prefs.eprintKey());
	}

	eprintIdsOf(items) {
		return items.filter((item) => item.isRegularItem()).map((item) => this.eprintIdOf(item)).filter(Boolean);
	}

	openEprintPages(items) {
		for (const id of this.eprintIdsOf(items)) this.Zotero.launchURL(eprintPageURL(id));
	}
}
