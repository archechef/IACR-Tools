# Developer guide

Everything needed to continue work on IACR Tools: how the code is organised, the conventions it follows, how it is tested and released, and which outside facts it relies on. User documentation is in the [README](../README.md); a short checklist for coding agents is in [AGENTS.md](../AGENTS.md).

## Contents

- [Quick start](#quick-start)
- [How the plugin is put together](#how-the-plugin-is-put-together)
- [Module map](#module-map)
- [Conventions](#conventions)
- [Testing](#testing)
- [How to …](#how-to-)
- [Outside facts the code relies on](#outside-facts-the-code-relies-on)
- [Releasing](#releasing)
- [Known limitations and open ends](#known-limitations-and-open-ends)

## Quick start

Requirements: Node.js 20 or later (CI uses 22). No other tools: the build packs the `.xpi` itself.

```sh
npm ci             # esbuild (bundler) and TypeScript (type checking only)
npm run check      # JSDoc type check (tsc -p jsconfig.json); must pass
npm run build      # build/addon/ and build/zotero-iacr-tools-<version>.xpi, plus build/updates.json
npm test           # node:test, all files test/*.test.js
```

Run `npm run build` before `npm test`: `test/bundle.test.js` runs the *built* plugin and is skipped when `build/addon/` is missing (CI builds first). A change is done when check, build and test all pass.

To try a build in Zotero: **Tools → Plugins → gear icon → Install Plugin From File…** with `build/zotero-iacr-tools-<version>.xpi`. Debug output (`Zotero.debug`, prefixed `IACR Tools:`) is under **Help → Troubleshooting Mode / Debug Output Logging**.

## How the plugin is put together

### Layers

```
addon/      what Zotero loads: manifest, bootstrap.js, windows (xhtml/js/css), preference pane, locale
src/        the plugin, bundled by esbuild into addon/content/iacr-tools.js
  config.js     every constant (names, URLs, preferences, thresholds, patterns)
  core/         pure logic: no Zotero, no network, no files; unit-tested directly
  zotero/       Zotero integration; every dependency is injected (Zotero, http, files, prefs, timers)
  ui/           menus, progress and duplicate windows (their plugin side), dialogs, item-tree column, Fluent
  plugin.js     wires services together; one method per user-facing command
  index.js      bundle entry: collects the bootstrap globals and creates the plugin
test/       node:test suites, a fake Zotero, CryptoBib and schema fixtures
scripts/    build.mjs (template addon/, bundle src/, zip, write updates.json)
types/      globals of the bootstrap scope for the type checker
```

`core/` never imports from `zotero/` or `ui/`. `zotero/` code receives Zotero and the platform through constructor arguments (`deps`), never through globals, which is what makes it testable with `test/fake-zotero.js`.

### Startup and shutdown

1. Zotero calls `startup()` in [addon/bootstrap.js](../addon/bootstrap.js). It registers `addon/content/` as `chrome://iacr-tools/content/` (see [chrome registration](#chrome-registration)) and loads the bundle with the bootstrap globals.
2. [src/index.js](../src/index.js) creates `IACRTools` and exposes it as `Zotero.IACRTools`. It also passes Zotero's item merge (`mergeItems.mjs`).
3. `IACRTools.startup()` ([src/plugin.js](../src/plugin.js)) registers preference defaults, the preference pane, the ePrint column, the menus, and starts the automatic processing of new items.
4. On shutdown (except when Zotero itself quits) everything is unregistered and the chrome registration is destructed.

### Commands, actions and the pipeline

Most features are **actions**: `{ id, run(context) }` objects that edit one item and return a result (`result.changed / unchanged / skipped / failed(detail)` from [pipeline.js](../src/zotero/pipeline.js)).

- A **command** ([`COMMANDS` in plugin.js](../src/plugin.js)) is a list of action names. Where it appears is set by `MENU_LAYOUT` in [ui/menus.js](../src/ui/menus.js): the one layout of the IACR submenu (Update All, then the groups Metadata, ePrint, Duplicates & Versions, Copy & Export, and Add Papers on collections), used for items *and* collections. Its Fluent ids are `menu-<id>` and `progress-<id>`; groups use `menu-group-<group>`.
- The **pipeline** runs a command's actions over many items: the actions of one item in order, several items in parallel (`concurrency`, from the preference), each item by one task only. It skips non-regular items and read-only libraries, and can be stopped (`shouldStop`).
- Each item gets an **`ItemContext`**: `context.item` (an `ItemWrapper`), `context.store` (CryptoBib), `context.memo(key, fn)` for lookups shared by the actions of that item (e.g. the CryptoBib match, the ePrint id), and `context.library()`: the library's papers (`LibraryIndex`), loaded once per pipeline run.
- **Automatic processing** ([auto-processor.js](../src/zotero/auto-processor.js)) runs the actions enabled in the preferences (`AUTO_ACTIONS` in plugin.js) on newly added items, after a short debounce. It skips synced items and batches of more than 100, and is suspended while the imports add items themselves.

A failing action is caught by the pipeline and reported as `failed`; it does not stop the other actions or items.

### Other flows

- **List import** ([list-import.js](../src/zotero/list-import.js)): entries are resolved in parallel (CryptoBib, then the ePrint page, then the ePrint search, then Zotero's DOI lookup); placing an entry in the library (duplicate check, item creation) runs one entry at a time; follow-up work (CryptoBib sync, ePrint PDF) is queued per item, so a paper listed twice is created and downloaded once. Section lines (`[Topic / Sub]`, parsed in `core/list.js`) give entries `collections` paths, resolved below the target collection by `CollectionPaths` ([collections.js](../src/zotero/collections.js)) during placing. With `reorganize`, placing an existing paper also removes it from the collections below the target that this run did not file it into (`claims`, so a paper in two sections keeps both); results with `refiledTo` are handed to ZotMoov afterwards ([zotmoov.js](../src/zotero/zotmoov.js)).
- **Folder import** ([folder-import.js](../src/zotero/folder-import.js)): `scan()` changes nothing and builds a plan (new / already in the library / repeated file); `run()` imports file by file (sequentially: Zotero's recognizer is rate-limited).
- **CryptoBib** ([cryptobib-store.js](../src/zotero/cryptobib-store.js)): downloaded once into `<data dir>/iacr-tools/` (`crypto.bib`, `abbrev0…3.bib`, `meta.json`), parsed records cached as `records-v1-abbrevN.json`, the index loaded lazily and released after 15 minutes idle, refreshed in the background when older than the preference. A download without entries, without `@string` definitions or with less than half the previous entries is rejected.
- **Duplicates** ([core/duplicates.js](../src/core/duplicates.js) groups, [zotero/duplicates.js](../src/zotero/duplicates.js) finds, merges copies, merges a preprint into its published version, links and dismisses, [ui/duplicates.js](../src/ui/duplicates.js) drives the report window).
- **LaTeX** ([zotero/latex.js](../src/zotero/latex.js)): CryptoBib key when CryptoBib has the paper, else the BibTeX export's key.

### Windows

The plugin's own windows are plain HTML (no XUL custom elements), opened with `window.openDialog(chromeURL(ASSETS.x), …, io)`. Everything a window needs (state and labels) comes from the `io` object in `window.arguments[0]`; the window script only renders and calls back.

| Window | Files | Plugin side | Kind |
|---|---|---|---|
| Paste box (list import) | `addon/content/list-dialog.*` | `IACRTools.#collectList` | modal; writes `action`, `text`, `download` and `loaded` back into `io` |
| Progress | `addon/content/progress.*` | `DialogView` in [ui/progress.js](../src/ui/progress.js) | non-modal; `state`, `labels`, `subscribe()`, `requestStop()` |
| Duplicate report | `addon/content/duplicates.*` | `DuplicatesView` in [ui/duplicates.js](../src/ui/duplicates.js) | non-modal; `state`, `format()`, `subscribe()`, actions |

Fallbacks: if the paste box does not set `io.loaded`, the command falls back to the clipboard and a plain confirmation; if the progress window cannot be opened (or the preference is off), the run reports in Zotero's small `ProgressWindow` pop-up (`ToastView`); if a progress window is closed before the end, the outcome is shown in a pop-up.

All three use system colours (`Canvas`, `Field`, `GrayText`, `AccentColor`, `light-dark()`) and `color-scheme: light dark`, so they follow Zotero's light and dark mode.

## Module map

### src/core (pure)

| File | Purpose |
|---|---|
| `bibtex.js` | BibTeX parser with `@string` macros and `#` concatenation; values stay unresolved until a `MacroTable` resolves them |
| `latex.js` | LaTeX → Unicode, or Zotero's rich-text subset (`<i>`, `<sub>`, …) for titles |
| `text.js` | normalization, title keys, Dice similarity, BibTeX names, DOIs; `titleKey` / `lastNameKey` are memoized |
| `matching.js` | `scoreCandidate` / `bestMatch`: DOI, then title + authors; one rule set for every source |
| `cryptobib.js` | CryptoBib records and the index (by key, DOI, ePrint id, title, author) |
| `mapping.js` | declarative CryptoBib → Zotero field mapping |
| `eprint.js` | ePrint ids (`2008/045`): parsing, formatting, URLs |
| `eprint-page.js` | metadata and revision time from an ePrint paper page's meta tags |
| `extra.js` | `Key: value` lines in Zotero's Extra field |
| `pdf-text.js` | DOIs / ePrint ids in PDF text and file names; identifying a PDF in CryptoBib |
| `list.js`, `list-format.js` | reading lists: parse (including `[Section]` lines and collection paths) and write (flat, or with a section per subcollection) |
| `duplicates.js` | grouping papers into copies and versions |
| `concurrency.js` | `mapConcurrent` (bounded parallelism, stoppable), `serialized`, `serializedByKey` |

### src/zotero (Zotero integration)

| File | Purpose |
|---|---|
| `platform.js` | the only adapters to Zotero.HTTP and IOUtils/PathUtils (`Http`, `FileStore`) |
| `prefs.js` | typed preferences over `PREFS` in config.js |
| `item.js` | `ItemWrapper`: base-field resolution, Extra fallback, type conversion, related items; all item edits go through it |
| `pipeline.js` | actions, `ItemContext`, `Pipeline` |
| `springer.js`, `cryptobib-sync.js`, `eprint.js`, `versions.js` | the actions (Springer conversion; CryptoBib sync; ePrint find / download / revision check; preprint upgrade / version links) |
| `eprint-sources.js` | ePrint lookup sources (CryptoBib, dblp, eprint.iacr.org search) behind one interface |
| `cryptobib-store.js` | download, validation, cache, lazy index |
| `library-index.js` | a library's papers (DOI, ePrint id, title + authors) and PDF files (path, MD5, size); finds a paper's duplicate or other version |
| `create-item.js` | new items from a CryptoBib record or an ePrint page |
| `list-import.js`, `list-export.js`, `folder-import.js` | the imports and the list export |
| `collections.js` | `CollectionPaths`: collections by path below a base, created when missing (both imports) |
| `doi-pdf.js` | `DoiPdfAction`: the PDF of a paper without an ePrint version through Zotero's Find Full Text, one request at a time |
| `zotmoov.js` | asks ZotMoov to move the files of papers the list import moved between collections |
| `latex.js` | `\cite` keys and the BibTeX export of papers CryptoBib lacks |
| `duplicates.js` | `DuplicateFinder`: find groups, merge copies, merge a preprint into its published version, link versions, dismiss |
| `auto-processor.js` | processing of newly added items |

### src/ui

| File | Purpose |
|---|---|
| `menus.js` | all menus via `Zotero.MenuManager`; `MENU_LAYOUT` defines the IACR submenu shared by items and collections (entries per scope), plus File and Tools |
| `progress.js` | progress reporters (`BatchProgress`, `ListProgress`, `FolderImportProgress`) and views (`DialogView`, `ToastView`) |
| `duplicates.js` | `DuplicatesView`, the state and actions behind the report window |
| `dialogs.js` | native dialogs: file / folder pickers, confirm, alert, the paste box |
| `target.js` | which library and collection a command applies to (menu context, then the pane's selection) |
| `column.js` | the sortable ePrint column |
| `l10n.js` | Fluent formatting from code |

### addon/

`manifest.json`, `bootstrap.js`, `content/` (windows, preference pane, icon, the bundle), `locale/en-US/iacr-tools.ftl`. These files are **templates**: the build replaces `__PLACEHOLDERS__` (see below).

### test/

| File | Covers |
|---|---|
| `fake-zotero.js` | the in-memory Zotero used by all integration tests (schema from `fixtures/zotero-schema.json`) |
| `core.test.js` | parser, LaTeX, names, matching, CryptoBib index, Extra, matching speed |
| `zotero.test.js` | actions, ePrint sources, automatic processing, the CryptoBib store, Fluent ids |
| `list-import.test.js`, `folder-import.test.js` | the imports |
| `versions.test.js` | preprint upgrade, version links, revision check, LaTeX |
| `duplicates.test.js` | grouping, `DuplicateFinder`, `DuplicatesView` |
| `concurrency.test.js`, `progress.test.js`, `list-dialog.test.js` | helpers, the progress view, the paste box script |
| `bundle.test.js` | the **built** plugin in a VM: bootstrap, chrome registration, menus, commands, windows, preferences, shutdown |

## Conventions

- **One source of truth for constants.** Names, ids, URLs, preference keys and defaults, thresholds and patterns live in [src/config.js](../src/config.js). The build fills them into `addon/` through placeholders: `__PLUGIN_NAME__`, `__PLUGIN_ID__`, `__GLOBAL_NAME__`, `__CHROME_PACKAGE__`, `__PREF_BRANCH__`, `__L10N_PREFIX__`, `__FTL__`, `__BUNDLE_PATH__`, `__ICON__`, `__VERSION__`, `__UPDATE_URL__`, `__DESCRIPTION__` ([scripts/build.mjs](../scripts/build.mjs)). An unknown placeholder fails the build.
- **Dependencies are injected.** Code under `src/zotero` and `src/ui` takes `Zotero`, `http`, `files`, `prefs`, `timers`, `log` as constructor arguments. Do not reach for globals.
- **Item edits go through `ItemWrapper`** (it resolves base fields such as `publicationTitle` → `proceedingsTitle`, falls back to Extra, and only saves when something changed).
- **Matching goes through `bestMatch` / `scoreCandidate`**, so every source follows the same rules: a DOI decides; otherwise title similarity and author overlap; short titles must match exactly and be backed by authors; same-type items with different DOIs are different publications.
- **User-visible text is in Fluent** ([addon/locale/en-US/iacr-tools.ftl](../addon/locale/en-US/iacr-tools.ftl)), ids prefixed `iacr-tools-`; code uses the id without prefix (`l10n.format("list-title")`). Result *details* of actions (e.g. `"no ePrint version found"`) are plain English strings in code.
- **Style**: tabs, double quotes, ES modules, JSDoc types (checked by `npm run check`, `noUnusedLocals` on). Comments explain *why*; files start with a short comment saying what they are for.
- **Network politeness**: lookups run sequentially per item and at most `concurrency` (1–8, default 4) items at once; Zotero.HTTP retries throttled requests for up to 15 s.

## Testing

- **Unit tests** call `src/core` directly.
- **Integration tests** run the `src/zotero` and `src/ui` classes against `test/fake-zotero.js`, which mirrors the parts of the Zotero API the plugin uses (items with real schema fields and base-field mapping, `setType`, attachments, collections, relations, notifier, prefs, translators, recognizer). When the plugin starts using another Zotero API, add it to the fake *as Zotero behaves*, with a comment.
- **The bundle test** loads `build/addon/bootstrap.js` and the built bundle in a `vm` context with fakes for `Services`, `IOUtils`, `ChromeUtils`, `Cc`/`Ci`, and drives the registered menus end to end. It also checks that every option passed to Zotero's plugin APIs is one Zotero accepts (lists at the top of the file). Values created inside the VM have their own `Array` prototype: compare them as JSON.
- **The Fluent check** (`zotero.test.js`) verifies that every id used in `src/plugin.js`, `src/ui/menus.js`, `src/ui/progress.js`, `src/ui/duplicates.js` and `addon/content/duplicates.js` exists in the `.ftl` file. Add new files that format ids to its list.
- **Windows** cannot run in Node beyond simple fake-DOM tests (`list-dialog.test.js`). To look at one, serve a copy of its `.css`/`.js` with an HTML page that sets `window.arguments = [io]` (a fake `io` with sample state) before loading the script, e.g. `python -m http.server`, and open it in a browser in light and dark mode. Plain `file://` pages may not run scripts in some previewers.
- Not covered by automated tests: behaviour inside the real Zotero. After changes to windows, menus, bootstrap or merges, try a build in Zotero.

## How to …

### Add an action and a menu command

1. Write the action (`{ id, async run(context) }` returning `result.*`), usually in `src/zotero/`.
2. Register it in `this.actions` in `IACRTools`'s constructor.
3. Add a command to `COMMANDS` (id and action names) and place it in a group of `MENU_LAYOUT` in `src/ui/menus.js`; it then appears in the item *and* collection IACR submenus. The bundle test fails if a command is missing from the layout or a menu entry has no label.
4. Add `iacr-tools-menu-<id>` (with `.label`) and `iacr-tools-progress-<id>` to the `.ftl` file.
5. Optionally run it on new items: a preference in `PREFS` and an entry in `AUTO_ACTIONS`.
6. Test it with the pipeline (`versions.test.js` shows the pattern), and mention it in the README.

### Add a preference

1. Add it to `PREFS` in config.js (`key`, `default`); defaults are registered at startup.
2. Add a control to [addon/content/preferences.xhtml](../addon/content/preferences.xhtml) with `preference="__PREF_BRANCH__<key>"` and a Fluent label (`iacr-tools-pref-…`).
3. Read it with `prefs.get("<name>")`; add it to the README's preference table.

### Add a window

Follow the progress window: `addon/content/<name>.xhtml/.js/.css` as plain HTML; a path in `ASSETS`; a plugin-side class holding the state, with `subscribe()` and the actions the window calls; open it with `parentWindow.openDialog(chromeURL(ASSETS.<name>), "_blank", "chrome,dialog=no,resizable,centerscreen,width=…,height=…", view)`. Test the class with a fake `openDialog`, and preview the page in a browser as described above.

### Add a user-visible string

Add `iacr-tools-<id> = …` to the `.ftl` file and use `l10n.format("<id>", args)`. Fluent pitfalls: a literal `{` or `}` must be written `{"{"}` / `{"}"}`; plurals use `{ $count -> [one] … *[other] … }`; menu labels are attributes (`.label = …`).

## Outside facts the code relies on

Verified while building the plugin, against Zotero 10.0.3's own source (`omni.ja` in the Zotero program folder) and the live sites, October 2026. Re-check them when something breaks after a Zotero update.

### Zotero

- <a id="chrome-registration"></a>**Chrome registration.** Windows must be opened from a `chrome://` URL: loaded from the `.xpi` (a `jar:` URL) they stay blank. `bootstrap.js` registers `content/` with `Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup).registerChrome(manifestURI, [["content", "iacr-tools", "content/"]])` and destructs the handle on shutdown (as Zotero's plugin docs and other plugins, e.g. ZotMoov, do).
- **Plugin APIs (Zotero 8+)**: `Zotero.MenuManager.registerMenu` (targets `main/library/item`, `main/library/collection`, `main/menubar/file`, `main/menubar/tools`), `Zotero.ItemTreeManager.registerColumn`, `Zotero.PreferencePanes.register`. Accepted option names are listed in `bundle.test.js`.
- **Merging items**: `mergeItems(master, others)` from `chrome://zotero/content/mergeItems.mjs` (`Zotero.Items.merge` is deprecated). It runs in one transaction, moves notes, tags, collections, relations and attachments to the master, keeps the master's fields, trashes the others and registers an undo step. It does not check item types; Zotero's duplicate pane only merges items of one type, so the plugin converts copies to the master's type first.
- **File pickers**: `chrome://zotero/content/modules/filePicker.mjs`.
- **Item basics**: `item.getField("year")`, `item.relatedItems` (keys), `item.addRelatedItem(other)` (false if already related; throws for an item in another library), `item.setType(typeID)` carries base-mapped fields over to the new type and clears the others (a preprint's `repository` becomes `publisher`, which `versions.js` prevents), `item.dateAdded` is `YYYY-MM-DD HH:MM:SS` in UTC.
- **Collections**: `collection.getChildItems(asIDs)` (the items directly in it), `getChildCollections()`. Zotero's preference `recursiveCollections` (View → Show Items from Subcollections, off by default) only affects the display; the plugin's collection commands use its own preference `collectionsIncludeSubcollections` (`IACRTools.collectionPapers`).
- **Collection membership**: `item.getCollections()` (ids of the collections the item is directly in), `item.addToCollection(id)` / `item.removeFromCollection(id)`, saved with `item.saveTx()`. `new Zotero.Collection({ name, libraryID, parentID })`; `Zotero.Collections.getByParent(id)` / `getByLibrary(libraryID)` (top level); a top-level collection's `parentID` is `false`.
- **Find Full Text**: `Zotero.Attachments.addAvailableFile(item, { methods })` (Zotero 7+; `addAvailablePDF` is deprecated) tries resolvers in order — `doi` (the `https://doi.org/<DOI>` page, fetched with `Zotero.HTTP.request` and its redirects followed, so IP-based institutional access applies), `url` (the item's URL), `oa` (Unpaywall via `Zotero.Utilities.Internal.getOpenAccessPDFURLs`), `custom` (the JSON preference `extensions.zotero.findPDFs.resolvers`) — and returns the new attachment or `false`. It may show a CAPTCHA dialog. It does not throttle by itself: only the batch version `addAvailableFiles` (the context menu, with its own queue window) spaces requests to the same domain by 1 s. `canFindFileForItem` requires a DOI, URL or PMCID and no PDF/EPUB attachment.
- **Export translators**: Zotero's BibTeX is `9cb70025-a888-4a29-a210-93ec52da40d4` and uses an item's `citationKey` field or a `Citation Key:` line in Extra when present; Better BibTeX is `ca65189f-8815-4afe-8c8b-8c7c15f0edca`, its pinned keys come from `Zotero.BetterBibTeX.KeyManager.get(itemID)?.citationKey`.

### ZotMoov

Read from ZotMoov 1.2.32's source (`zotmoov@wileyy.com.xpi` in the Zotero profile's `extensions` folder). It exposes `Zotero.ZotMoov`.

- **Auto-move** of new attachments (a notifier on `add`, after a delay) only handles stored files and calls `move(items, dst_dir, getBasePrefs())`.
- **`{%c}`** (subdirectory wildcard) uses the item's collection whose id is `preferred_collection`, else the item's *first* collection. `getBasePrefs()` sets `preferred_collection` to the collection selected in the pane, so new papers filed only in a subcollection land in that subcollection's folder.
- **`move(attachments, dst_dir, options)`** re-links each file attachment to `<dst_dir>/<subdirectory>/<renamed file>` (skipping ones already there and libraries other than My Library). The plugin passes `{ ...getBasePrefs(), preferred_collection }` and only linked files, so it never races the auto-move.
- Preferences: `extensions.zotmoov.dst_dir`, `file_behavior` (`"move"` / `"copy"`), `enable_subdir_move`, `subdirectory_string`.

### IACR ePrint, dblp, CryptoBib

- **ePrint paper page** `https://eprint.iacr.org/<id>`: Highwire / OpenGraph meta tags (`citation_title`, `citation_author`, `og:description`, `article:tag`, …); `article:modified_time` is the last revision, `article:published_time` the first; the PDF is `<id>.pdf`; all versions are listed under `/archive/versions/<id>`.
- **ePrint search** `https://eprint.iacr.org/search?q=…`: results are `.results > div`, title `div > strong:first-child`, link `a.paperlink` (the same selectors Zotero's ePrint translator uses).
- **dblp** `https://dblp.org/search/publ/api?format=json&q=…`: ePrint papers are recognised by a venue mentioning "ePrint" or an `ee` link to eprint.iacr.org; their volume is the year and their pages the number.
- **CryptoBib** export: `https://raw.githubusercontent.com/cryptobib/export/master/` with `crypto.bib` and `abbrev0.bib` … `abbrev3.bib` (venue names from full to shortest); keys like `EC:Bernstein08`, ePrint entries `EPRINT:…`; conference macros `<conf><yy>name[N]` / `<conf><yy>key[N]`.

## Releasing

1. Raise `version` in `package.json` (`npm version X.Y.Z --no-git-tag-version`) and add the release to [CHANGELOG.md](../CHANGELOG.md).
2. Run check, build and test; commit; push `main`.
3. `git tag vX.Y.Z` and `git push origin vX.Y.Z`. The release workflow checks that the tag matches `package.json`, builds, tests and creates the GitHub release with the `.xpi` and `updates.json`.
4. Installed copies check `releases/latest/download/updates.json` about once a day and install the new `.xpi` (verified against its SHA-256).

Never reuse a version number and never move a tag that has a release: Zotero only installs higher versions. If a release is wrong, publish the next patch version.

The GitHub Actions are pinned to commit hashes (with the version as a comment); update hash and comment together.

## Known limitations and open ends

- **Only tested against a fake Zotero.** The windows, menus, chrome registration and merges have not been exercised by automated tests inside a real Zotero; check them by hand after changes.
- **Preprint upgrade and LaTeX keys use CryptoBib only**, so only cryptography venues are covered (a preprint published at, say, CCS stays a preprint). dblp could fill the gap.
- **`\cite` keys without Better BibTeX**: for items without a stored key, the key comes from exporting the item on its own; when two such items collide, Zotero's export of both together adds a suffix, so the `.bib` file may differ.
- **Duplicate groups are transitive**: A ~ B and B ~ C put A, B and C in one group even if A and C would not match. "Not the Same Paper" remembers the exact group (its sorted item keys), up to 1000 groups, in the preference `duplicates.dismissed`.
- **Revision check**: a metadata-only change on ePrint also bumps `article:modified_time`; the new download is then discarded as identical, and the revision is recorded so it is not fetched again.
- **Automatic processing** skips synced items and batches of more than 100 items.
- **Reorganizing with a list** only moves the papers the list names; nothing removes a paper the list leaves out. The ZotMoov hand-off depends on ZotMoov's internal methods (`move`, `getBasePrefs`) and does nothing if they change.
- **List sections** are not read from BibTeX lists.
- **Only an English locale** (`en-US`); another language is a new `.ftl` file under `addon/locale/<locale>/`.
