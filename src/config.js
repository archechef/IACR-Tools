/**
 * Central configuration. Every tunable constant of the plugin lives here so
 * that the rest of the code never embeds magic strings or numbers.
 */

export const PLUGIN = Object.freeze({
	id: "iacr-tools@zotero.plugin",
	name: "IACR Tools",
	/** Global namespace under which the plugin instance is exposed (Zotero.IACRTools). */
	globalName: "IACRTools",
	/** Fluent resource file shipped in addon/locale/<locale>/. */
	ftl: "iacr-tools.ftl",
	/** Prefix of all Fluent message ids. */
	l10nPrefix: "iacr-tools",
	prefBranch: "extensions.iacr-tools.",
	/**
	 * Name under which addon/content/ is registered as chrome://<name>/content/.
	 * The plugin's own windows must be opened from there: loaded straight from
	 * the .xpi (a jar: URL), they stay blank.
	 */
	chromePackage: "iacr-tools",
	/** Sub-folder of the Zotero data directory used for the CryptoBib cache. */
	dataDirName: "iacr-tools",
	/**
	 * Zotero requires an update manifest URL (applications.zotero.update_url).
	 * `npm run build` writes the matching build/updates.json; publish it at this URL
	 * (together with the .xpi at `xpiURL`) to deliver updates.
	 */
	// Both files are attached to the GitHub release of each version
	// (.github/workflows/release.yml); "latest" always serves the newest manifest.
	updateURL: "https://github.com/archechef/IACR-Tools/releases/latest/download/updates.json",
	xpiURL: (version) => `https://github.com/archechef/IACR-Tools/releases/download/v${version}/zotero-iacr-tools-${version}.xpi`,
});

/** Files shipped in addon/, relative to the plugin root. */
export const ASSETS = Object.freeze({
	/** The bundled plugin code (built from src/index.js). */
	bundle: "content/iacr-tools.js",
	icon: "content/icons/iacr.svg",
	preferencePane: "content/preferences.xhtml",
	preferenceScript: "content/preferences.js",
	/** The paste box of "Add Papers from a List". */
	listDialog: "content/list-dialog.xhtml",
	/** The window that follows a list import, folder import or menu command. */
	progressDialog: "content/progress.xhtml",
	/** The report of duplicate papers. */
	duplicatesDialog: "content/duplicates.xhtml",
});

/** chrome:// URL of a file in addon/content/ ("content/x.xhtml" → "chrome://iacr-tools/content/x.xhtml"). */
export const chromeURL = (asset) => `chrome://${PLUGIN.chromePackage}/${asset}`;

/**
 * User preferences with their default values. Defaults are registered on the
 * default pref branch at startup, so this table is the single source of truth.
 */
export const PREFS = Object.freeze({
	autoConvertSpringer: { key: "autoConvertSpringer", default: true },
	autoSyncCryptoBib: { key: "autoSyncCryptoBib", default: true },
	autoFindEprint: { key: "autoFindEprint", default: false },
	autoDownloadEprint: { key: "autoDownloadEprint", default: false },
	/** New preprints that CryptoBib lists as published become the published paper. */
	autoUpgradePreprints: { key: "autoUpgradePreprints", default: false },
	/** New items are linked (as related items) with their ePrint or published version in the library. */
	autoLinkVersions: { key: "autoLinkVersions", default: true },
	overwriteFields: { key: "overwriteFields", default: true },
	replaceCreators: { key: "replaceCreators", default: true },
	/** Which CryptoBib abbreviation level to use: 0 (full names) … 3 (shortest). */
	abbrevLevel: { key: "abbrevLevel", default: 0 },
	cryptobibBaseURL: {
		key: "cryptobibBaseURL",
		default: "https://raw.githubusercontent.com/cryptobib/export/master/",
	},
	cryptobibMaxAgeDays: { key: "cryptobibMaxAgeDays", default: 30 },
	eprintExtraKey: { key: "eprintExtraKey", default: "IACR ePrint" },
	useOnlineEprintSearch: { key: "useOnlineEprintSearch", default: true },
	/** Folder import: link to the files instead of copying them into Zotero storage. */
	folderImportLinkFiles: { key: "folderImport.linkFiles", default: false },
	/** Folder import: create a collection for the folder and sub-collections for its subfolders. */
	folderImportSubcollections: { key: "folderImport.subcollections", default: true },
	/** Folder import: look up the ePrint versions of the imported papers. */
	folderImportFindEprint: { key: "folderImport.findEprint", default: true },
	/** Folder import: also download the ePrint PDFs that were found. */
	folderImportDownloadEprint: { key: "folderImport.downloadEprint", default: false },
	/** Folder import: attach a PDF to the existing item when the paper is already in the library without a PDF. */
	folderImportAttachToExisting: { key: "folderImport.attachToExisting", default: true },
	/** List import: download the ePrint PDF of every paper added from a list. */
	listDownloadPdf: { key: "listImport.downloadPdf", default: true },
	/** A revised ePrint PDF replaces the old one (moved to the trash) instead of being added next to it. */
	replaceRevisedEprint: { key: "replaceRevisedEprint", default: false },
	/** Papers looked up or downloaded at the same time (list import, menu commands). */
	concurrency: { key: "concurrency", default: 4 },
	/** Long runs report in a window of their own; off: Zotero's small pop-up. */
	progressWindow: { key: "progressWindow", default: true },
	/** Duplicate groups marked "not the same paper" (JSON list of group signatures). */
	duplicatesDismissed: { key: "duplicates.dismissed", default: "[]" },
});

const EPRINT_ITEM_TYPE = "preprint";

export const CRYPTOBIB = Object.freeze({
	mainFile: "crypto.bib",
	abbrevFile: (level) => `abbrev${level}.bib`,
	abbrevLevels: [0, 1, 2, 3],
	metaFile: "meta.json",
	/** Parsed records are cached as JSON; bump the version when the record format changes. */
	recordsFile: (level) => `records-v1-abbrev${level}.json`,
	/** A refreshed download must keep at least this fraction of the previous entries. */
	minEntriesRatio: 0.5,
	/** Key prefix of ePrint entries in CryptoBib (e.g. "EPRINT:Bernstein08"). */
	eprintKeyPrefix: "EPRINT:",
	/**
	 * CryptoBib names its conference macros "<conf><yy>name[N]" for the book title
	 * and "<conf><yy>key[N]" for the short conference label (e.g. "eurocrypt08name"
	 * / "eurocrypt08key"). This lets us recover the conference name.
	 */
	bookTitleMacro: /^(.*)name(\d*)$/,
	conferenceKeyMacro: (prefix, part) => `${prefix}key${part}`,
	/** Strip the ", Part I" suffix of multi-volume proceedings from the conference label. */
	conferencePartSuffix: /,\s*Part\s+[IVXLC\d]+$/i,
	/**
	 * Item type changes applied when CryptoBib disagrees with Zotero
	 * (current Zotero type → CryptoBib-derived types it may become).
	 */
	typeConversions: { bookSection: ["conferencePaper"], document: ["conferencePaper", "journalArticle"] },
	/** Preprints are the ePrint versions themselves; they are never overwritten with the published metadata. */
	skippedItemTypes: [EPRINT_ITEM_TYPE],
});

export const MATCHING = Object.freeze({
	/** Minimum bigram Dice similarity for fuzzy title matches. */
	titleSimilarity: 0.88,
	/** Title similarity required when authors cannot be compared. */
	titleSimilarityWithoutAuthors: 0.95,
	/** Fraction of author last names that must overlap. */
	authorOverlap: 0.5,
	/** Accept a published-version match whose year differs by at most this much. */
	yearTolerance: 1,
	/** Version notes that differ between the ePrint, proceedings and full versions of a paper. */
	titleVersionNote: /[\s:.–—-]*[([]?\s*(extended abstract|full version|long version|short paper|abridged|preliminary version|invited( talk| paper)?)\s*[)\]]?\s*\.?\s*$/i,
	/**
	 * A title that extends another one (a subtitle added or dropped) matches when the
	 * shared prefix has at least this many characters and the authors agree.
	 */
	minSharedPrefix: 24,
	/** Titles whose normalized form is shorter than this must match exactly (with authors). */
	minTitleLength: 12,
	/** Normalized titles and names kept in memory for repeated comparisons. */
	keyCacheSize: 200_000,
	/** Lower-case name particles that belong to the last name. */
	nameParticles: ["von", "van", "de", "der", "den", "di", "da", "du", "le", "la", "del", "della", "dos", "das", "ter", "ten", "zu", "af", "al", "el", "bin", "ibn"],
});

export const SPRINGER = Object.freeze({
	/** DOI prefixes registered by Springer. */
	doiPrefixes: ["10.1007/"],
	/** Book series that (almost) exclusively publish conference proceedings. */
	proceedingsSeries: [
		/lecture notes in computer science/i,
		/^lncs$/i,
		/communications in computer and information science/i,
		/lecture notes in business information processing/i,
		/lecture notes of the institute for computer sciences/i,
		/ifip advances in information and communication technology/i,
	],
	/** Book titles that name a conference / workshop. */
	proceedingsTitle: /\b(proceedings|conference|symposium|workshop|congress|colloquium|advances in cryptology)\b/i,
	/** Item types that Springer uses for chapters of proceedings volumes. */
	sourceItemTypes: ["bookSection"],
	targetItemType: "conferencePaper",
});

const EPRINT_BASE_URL = "https://eprint.iacr.org/";

export const EPRINT = Object.freeze({
	baseURL: EPRINT_BASE_URL,
	/**
	 * Matches "2008/123", "https://eprint.iacr.org/2008/123", "…/2008/123.pdf"
	 * and both of the archive's own wordings, "Report 2008/123" (until 2022) and
	 * "Paper 2008/123".
	 */
	idPattern: /(?:^|eprint\.iacr\.org\/|(?:Report|Paper)\s+)(\d{4})\/(\d{1,5})(?:\.pdf)?\b/i,
	/** Zotero item type of ePrint items saved from eprint.iacr.org (they carry their own id). */
	itemType: EPRINT_ITEM_TYPE,
	pageURL: (id) => `${EPRINT_BASE_URL}${id}`,
	pdfURL: (id) => `${EPRINT_BASE_URL}${id}.pdf`,
	searchURL: (query) => `${EPRINT_BASE_URL}search?q=${encodeURIComponent(query)}`,
	/** CSS selectors of eprint.iacr.org text-search results (see Zotero's "ePrint IACR" translator). */
	searchSelectors: {
		row: ".results > div",
		title: "div > strong:first-child",
		link: "a.paperlink",
	},
	attachmentTitle: "IACR ePrint Full Text PDF",
	/** Title of an older ePrint PDF kept next to a revised one. */
	olderAttachmentTitle: (date) => `IACR ePrint Full Text PDF (version of ${date})`,
	olderAttachmentTitlePattern: /^IACR ePrint Full Text PDF \(version of .*\)$/,
	/**
	 * Extra-field key recording the ePrint revision whose PDF the item has
	 * (the page's article:modified_time), next to the id ("<id key> version").
	 */
	versionKey: (eprintKey) => `${eprintKey} version`,
	pdfContentType: "application/pdf",
	/** Paper numbers are zero-padded to at least this many digits. */
	numberPadding: 3,
	/**
	 * Highwire / OpenGraph meta tags of an ePrint paper page, used to create an
	 * item for a paper that CryptoBib does not (yet) know.
	 */
	metaTags: Object.freeze({
		title: ["citation_title", "og:title"],
		author: ["citation_author"],
		date: ["article:published_time", "citation_publication_date", "citation_date"],
		/** When the paper was last revised. */
		modified: ["article:modified_time", "article:published_time"],
		abstract: ["og:description", "citation_abstract"],
		repository: ["citation_journal_title", "og:site_name"],
		keywords: ["article:tag"],
	}),
	/** Item type and fixed fields of an item created from an ePrint page. */
	repositoryName: "Cryptology ePrint Archive",
});

export const DBLP = Object.freeze({
	searchURL: (query, hits) =>
		`https://dblp.org/search/publ/api?format=json&h=${hits}&q=${encodeURIComponent(query)}`,
	maxHits: 20,
	/** dblp venue string used for the Cryptology ePrint Archive. */
	eprintVenue: /eprint/i,
});

export const NETWORK = Object.freeze({
	timeoutMs: 30_000,
	downloadTimeoutMs: 5 * 60_000,
	/** Give up retrying throttled (429/5xx) lookups after this long. */
	errorDelayMaxMs: 15_000,
	/** Bounds of the "concurrency" preference; kept low to be polite to eprint.iacr.org and dblp. */
	concurrency: { min: 1, max: 8 },
});

export const AUTO = Object.freeze({
	/** Delay after items are added before processing them (lets translators finish saving). */
	delayMs: 1500,
	/** Larger batches (e.g. a library import) are left alone; use the menu commands instead. */
	maxItemsPerBatch: 100,
});

export const FOLDER_IMPORT = Object.freeze({
	/** File extensions that are imported (lower case, without dot). */
	extensions: ["pdf"],
	/** Subfolders nested deeper than this are ignored (guards against symlink loops). */
	maxDepth: 16,
	/** Refuse folders with more PDFs than this. */
	maxFiles: 5000,
	/** Pages of text read from a PDF that Zotero could not recognize. */
	textPages: 2,
	/** ePrint ids as they appear on papers ("Cryptology ePrint Archive, Paper 2008/045", URLs). */
	eprintTextPattern: /(?:eprint\.iacr\.org\/|ePrint\s+Archive,?\s+(?:Paper|Report)\s+|ePrint\s+(?:Paper|Report)?\s*)(\d{4})\/(\d{1,5})\b/gi,
	/** ePrint ids in file names as saved from eprint.iacr.org ("2008-045.pdf", "eprint_2008_045.pdf"). */
	eprintFilePattern: /^(?:eprint[-_ ]?)?((?:19|20)\d{2})[-_](\d{3,5})(?:[-_ .][^/]*)?\.pdf$/i,
	/** DOIs in running text. */
	doiTextPattern: /\b10\.\d{4,9}\/[^\s"<>]+/g,
});

/** Reading lists: what the plugin accepts in a pasted or imported list of papers. */
export const LIST = Object.freeze({
	/** A comment: "#", "//" or "%" at the start of a line or after some text. */
	commentPattern: /(?:^|\s)(?:#|\/\/|%)\s?(.*)$/,
	/** Markdown bullets, numbering and quotes at the start of a line. */
	bulletPattern: /^\s*(?:[-*+•]|\d+[.)])\s+|^\s*["'“”']+|["'“”']+\s*$/g,
	/** CryptoBib citation keys such as "EC:Bernstein08" or "JC:LibYun20", as read from a list. */
	keyPattern: /(?:^|[\s[(])([A-Z][A-Za-z]{0,9}:[A-Za-z][A-Za-z0-9.+:-]{2,40})(?=$|[\s\])])/,
	/** The shape of a CryptoBib key, checked before writing one into a list. */
	cryptobibKeyPattern: /^[A-Z][A-Za-z]{0,9}:[A-Za-z]{2,}\d{2}[a-z]?$/,
	/** BibTeX input (a .bib file or a pasted bibliography). */
	bibtexPattern: /^[^%]*@[A-Za-z]+\s*[{(]/m,
	/** Trailing "— Authors, 2019" style annotations after a title. */
	titleAnnotation: /\s+[–—]\s+.*$/,
	/** At most this many entries per list. */
	maxEntries: 500,
	/** Column at which the title comment starts in a written list. */
	identifierWidth: 34,
	/** Titles are shortened to this length when written as a comment. */
	maxCommentLength: 100,
	/** File types offered by the file picker. */
	fileFilter: "*.txt; *.md; *.csv; *.bib; *.json",
});

/** LaTeX: \cite keys and a BibTeX file for the papers that crypto.bib lacks. */
export const LATEX = Object.freeze({
	/** Zotero's export translators: Better BibTeX when installed (its keys are pinned), else Zotero's own. */
	translators: Object.freeze({
		betterBibTeX: "ca65189f-8815-4afe-8c8b-8c7c15f0edca",
		bibTeX: "9cb70025-a888-4a29-a210-93ec52da40d4",
	}),
	citeCommand: "cite",
	/** Default name of the exported file, e.g. "my-paper-not-in-cryptobib.bib". */
	fileName: (source) => `${source || "papers"}-not-in-cryptobib.bib`,
	fileFilter: "*.bib",
});

/** The duplicate report. */
export const DUPLICATES = Object.freeze({
	/** Groups marked "not the same paper" that are remembered. */
	maxDismissed: 1000,
});

export const PROGRESS = Object.freeze({
	/** Per-item lines shown in the progress window; the summary line covers the rest. */
	maxItemLines: 15,
});

export const TIMING = Object.freeze({
	/** Parsing yields to the event loop after this many entries to keep the UI responsive. */
	parseChunkSize: 2000,
	progressCloseDelayMs: 4000,
	/** Release the in-memory CryptoBib index after this much inactivity. */
	indexIdleUnloadMs: 15 * 60_000,
});

/** Lines of the Extra field that we read or write. */
export const EXTRA = Object.freeze({
	citationKey: "Citation Key",
	doi: "DOI",
});

export const MS_PER_DAY = 24 * 60 * 60 * 1000;
