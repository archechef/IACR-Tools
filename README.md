# IACR Tools for Zotero

A Zotero 8–10 plugin for cryptographers:

- **Springer conference papers become “Conference Paper” items.** Springer publishes proceedings (LNCS, CCIS, …) as books, so Zotero saves their papers as *Book Section*. The plugin converts them. `bookTitle` becomes `proceedingsTitle`, and a DOI stored in Extra moves to the DOI field.
- **Metadata comes from [CryptoBib](https://cryptobib.di.ens.fr).** Items are matched by DOI, then by title and authors (with fuzzy matching). CryptoBib's values then replace or fill in the title, authors, editors, proceedings title, conference name (`EUROCRYPT 2008`), volume, pages, series, publisher, venue, date and DOI. The CryptoBib key (`EC:Bernstein08`) is stored as the citation key.
- **ePrint versions.** The plugin finds the IACR ePrint version of a paper (via CryptoBib, then dblp, then eprint.iacr.org search), stores its id and can download the PDF. It notices when the paper was revised on ePrint and fetches the new PDF.

- **Duplicate papers across versions.** A report of papers that are probably the same paper (copies of one publication, or its ePrint, conference and journal versions), to merge the copies and link the versions.

- **Preprints catch up with their publication.** A preprint that CryptoBib lists as published becomes the published paper (keeping its ePrint id and PDF), and the ePrint and published versions of a paper are linked as related items.

- **LaTeX with CryptoBib.** Copy a `\cite{…}` for the selected papers with their CryptoBib keys, and export only the papers CryptoBib lacks as a `.bib` file to use next to `crypto.bib`.

- **Import PDFs from a folder.** Imports the PDFs of a folder and its subfolders that are not in the library yet, retrieves their metadata, and can look up their ePrint versions.

- **Add papers from a list.** Paste (or open) a list of ePrint ids, DOIs, CryptoBib keys or titles and the plugin adds those papers, with their ePrint PDFs. Sections such as `[Signatures]` file the papers into subcollections, and papers already in the collection can be moved to where the list says they belong.

- **Copy papers out as a list.** The same format in the other direction: select papers (or a collection, with its subcollections as sections) and put them on the clipboard for a chat, a mail or a to-do list.

## Installation

1. Download `zotero-iacr-tools-<version>.xpi` from the [latest release](https://github.com/archechef/IACR-Tools/releases/latest). In Firefox, right-click the link and choose *Save Link As…*, otherwise Firefox tries to install it itself.
2. In Zotero, open **Tools → Plugins**, click the gear icon, choose **Install Plugin From File…** and select the `.xpi`.

Zotero checks for updates on its own once the plugin is installed.

## Adding papers from a list

**File → Add Papers from a List…** (or right-click a collection) opens a box holding the list, pre-filled from the clipboard, where it can be edited before anything happens; **Use a File Instead…** loads one from disk. Every paper that is not in the library yet is added, and a checkbox decides whether the ePrint PDFs are downloaded. (If the box cannot be opened, the command falls back to the clipboard and a plain confirmation.)

The other direction is **IACR → Copy as List** in the right-click menu of the selected items, and **IACR → Copy Papers as List** in the right-click menu of a collection: the papers land on the clipboard in exactly this format, so they can go into a chat and the answer can come straight back. A collection is copied with a section per subcollection (see below), so importing the list rebuilds the structure.

One entry per line; everything after `#` is ignored:

```
2024/1234                                    # ePrint id
https://eprint.iacr.org/2019/1234            # or its URL
Cryptology ePrint Archive, Paper 2008/045    # or the archive's own wording
10.1007/978-3-540-78967-3_5                  # DOI
EC:Bernstein08                               # CryptoBib key
Proving Tight Security for Rabin-Williams Signatures   # or just the title
```

Markdown bullets and numbering are stripped, and a BibTeX bibliography (`.bib` file or pasted) works as a list too. A title written as a comment behind an identifier is kept as a fallback, so `2024/9999 # Some Paper` still finds the paper when the id is wrong.

Each entry is resolved in this order: CryptoBib (by key, DOI, title, then ePrint id), the paper's ePrint page (its `citation_*` meta tags, for papers CryptoBib does not have yet), the ePrint full-text search (for titles), and finally Zotero's own DOI lookup. A paper that is already in the library is not added twice — but its ePrint PDF is fetched if it is missing.

### Sections: one list for several subcollections

A line in square brackets starts a section: the papers below it go into that subcollection of the collection the list is imported into. Missing subcollections are created; existing ones are found regardless of upper and lower case.

```
# Papers before the first section go into the selected collection itself
2008/045

[Signatures]
EC:Bernstein08                    # Proving Tight Security for Rabin-Williams Signatures

[Signatures / Lattice]            # nested: "/" or ">" with spaces around it, or "→"
2024/1234

[Phd → Project → Threshold]       # the selected collection's own path may be included
JC:LibYun20

[]                                # back to the selected collection
```

- A section's path is read below the selected collection. If it starts with the selected collection's own name (or its parents' names too, as in `Phd → Project → Topic` imported into *Phd → Project*), that part is dropped, so a list works whether it gives the full path or only the topic.
- A paper listed in two sections goes into both subcollections.
- `[2024/1234]` and other bracketed identifiers are papers, not sections. A `/` without spaces belongs to the name (`[PRF/PRP]`).
- Imported into the library root (no collection selected), section paths start at the top level.

**Reorganizing a collection.** With **Move papers already in “…” into the subcollections the list names** ticked in the paste box, a paper that is already somewhere in the selected collection (in it or any of its subcollections) is taken out of the subcollections the list does not name for it and put into those it does. So a paper sitting directly in *Project* moves to *Project → Signatures*, and one filed under the wrong topic moves to the right one. Without the box ticked, papers are only added to their sections and stay where they were. Either way:

- collections outside the selected one are never touched (a paper shared with another project stays there too);
- papers the list does not mention are left alone, so a list of a few papers never empties a topic;
- the progress window reports a moved paper as *already in library, moved*, with where from and where to.

**ZotMoov.** [ZotMoov](https://github.com/wileyyugioh/zotmoov) files PDFs in a folder per collection (`{%c}`) when they are added, but does not move them again when a paper changes collection. After reorganizing, the plugin asks ZotMoov to move the files of the moved papers into the folder of their new subcollection, as ZotMoov's own *Move Selected to Directory* would. This happens only when ZotMoov is installed and set to move (not copy) files into subdirectories, only for files ZotMoov already manages, and not for papers that are also in a collection outside the selected one (their file belongs to the other project as well). It can be switched off in the preferences. New papers need no help: ZotMoov uses the subcollection a paper was added to.

## Importing a folder of PDFs

**File → Import PDFs from Folder…** (or right-click a collection) asks for a folder, scans it and its subfolders, and shows what it found before changing anything.

1. **Files already in the library are skipped.** A PDF counts as known when a library attachment has the same path (linked files) or the same content (MD5, also compared with the hashes of synced files that are not downloaded). Identical copies within the folder are imported once.
2. **Each remaining PDF is imported and identified.** Zotero's "Retrieve Metadata for PDF" runs first. When it finds nothing, the plugin reads the file name and first pages: a DOI or ePrint id (e.g. `2008-045.pdf`) that CryptoBib knows is used, provided the paper's title appears in the text (so that cited DOIs are not mistaken for the paper's own). PDFs that cannot be identified stay as standalone attachments.
3. **Metadata is converted and updated from CryptoBib**, following the settings for new items.
4. **Papers that are already in the library are not duplicated.** After identification, a paper is matched against the library by DOI, ePrint id, or title and authors (publications with different DOIs, such as a conference and a journal version, are kept apart). If the existing item has no PDF, the PDF is added to it; otherwise the new item goes to the trash.
5. **ePrint versions** of the newly added papers are looked up (a checkbox in the confirmation dialog; the PDF can be downloaded too).

By default the folder becomes a collection (inside the selected collection) with a sub-collection per subfolder; existing collections with the same name are reused, and papers already in the library are added to the collection of their folder. Files are copied into Zotero storage by default; linking is available for My Library. Automatic processing of new items pauses during the import.

## Where the ePrint id is stored

Zotero has no user-defined fields. The id is stored as a line in **Extra**, `IACR ePrint: 2008/045`, which Zotero keeps and syncs. The key is configurable. A sortable **ePrint** column in the item list shows the id like a regular field; enable it via the column picker.

## Usage

- Right-click items → **IACR**:
  - Convert Springer Chapters to Conference Papers
  - Update Metadata from CryptoBib
  - Find ePrint Version
  - Find and Download ePrint PDF
  - Check for Revised ePrint Versions: when the ePrint page was revised after the attached PDF, the new PDF is added and the old one keeps its date in its title (or goes to the trash, see the preferences). An identical download is discarded.
  - Update Preprints to Published Versions: a preprint that CryptoBib lists as published gets the published metadata and type; its ePrint id stays in Extra and its PDF stays attached. If the published version is already in the library, the two are linked instead.
  - Link ePrint and Published Versions: marks the two versions of a paper as related items (by shared ePrint id, or by title and authors).
  - Do All of the Above (Except Downloads): convert, update preprints, update from CryptoBib, find the ePrint version, link versions.
  - Copy as List, Copy LaTeX Citation, Export BibTeX of Papers Not in CryptoBib…
  - Find Other Copies and Versions…: the duplicate report (below) for the selected papers
  - Open ePrint Page
- **Tools → Update CryptoBib Database**: fetches the latest export.
- **Tools → Find Duplicate Papers…**: the duplicate report for the library.
- Right-click a collection → **IACR**: the same commands for all papers of the collection (including its subcollections when **View → Show Items from Subcollections** is on), plus Copy Papers as List, Copy LaTeX Citation, Export BibTeX of Papers Not in CryptoBib… and Find Duplicate Papers…. Right-click a library (e.g. My Library) to run them on all its papers, after a confirmation.
- Long runs (imports, menu commands) report in a window of their own, listing every paper; **Stop** starts no new papers, **Close** lets the run finish in the background.
- **New items** (e.g. saved from Springer Link with the Zotero Connector) are converted, updated from CryptoBib and linked with their other version in the library automatically. ePrint lookup and download, and turning published preprints into the published paper, can be enabled in the preferences. Items that arrive through sync, and batches of more than 100 items, are left alone.

CryptoBib (~40 MB) is downloaded on first use into `<Zotero data dir>/iacr-tools/`. It is refreshed after 30 days, in the background.

## Duplicate papers

Zotero's own *Duplicate Items* finds copies of the same item type. The duplicate report also finds the versions of a paper: its ePrint preprint, the conference paper and the journal version. Papers belong together when they share a DOI or an ePrint id, or when their titles and authors match (years are not compared, since versions can be years apart). Two items of the same type with different DOIs are different publications.

Each group is a card. Copies of one publication (same type, or the same DOI, e.g. a Springer *Book Section* next to the *Conference Paper*) can be merged with Zotero's own merge: pick the one to keep (by default the one with a CryptoBib key, else a DOI, else more attachments), and its notes, tags, collections, related items and attachments are combined; the other copies go to the trash. An ePrint preprint can be merged into its published version with **Merge into One Item**: the published item keeps its metadata, the ePrint id is recorded in its Extra field, the preprint's PDF, notes, tags and collections move to it, and the preprint goes to the trash (when there are several published versions, e.g. a conference and a journal version, you choose which one to keep). Versions can also be linked as related items instead, one group at a time or all at once; linked versions are still reported, marked **Linked**, so that they can be merged later. **Not the Same Paper** hides a group for good (until it gains a member).

## LaTeX with CryptoBib

If you cite from CryptoBib's `crypto.bib`, **Copy LaTeX Citation** puts `\cite{EC:Bernstein08,…}` on the clipboard: papers CryptoBib has are cited by their CryptoBib key, the others by the key of your BibTeX export (Better BibTeX's pinned key when it is installed, else the item's citation key). **Export BibTeX of Papers Not in CryptoBib…** (also on collections) writes just those other papers to a file, e.g. `my-paper-not-in-cryptobib.bib`, so that

```latex
\bibliography{abbrev0,crypto,my-paper-not-in-cryptobib}
```

never defines a paper twice.

## Preferences (Settings → IACR Tools)

| Setting | Default |
|---|---|
| Automatic conversion / CryptoBib update / ePrint lookup / PDF download for new items | on / on / off / off |
| New items: turn published preprints into the published paper / link ePrint and published versions | off / on |
| Overwrite existing fields, replace authors and editors | on, on |
| Venue name style (CryptoBib `abbrev0` … `abbrev3`) | full (`abbrev0`) |
| CryptoBib refresh interval, download location | 30 days, GitHub `cryptobib/export` |
| Use dblp and eprint.iacr.org when CryptoBib has no ePrint entry | on |
| Extra-field key for the ePrint id | `IACR ePrint` |
| A revised ePrint PDF replaces the old one (otherwise both are kept) | off |
| Papers fetched at the same time (1–8) | 4 |
| Progress of imports and commands in a window of their own | on |
| Folder import: collections for folders, link instead of copy, add PDF to existing item | on, off, on |
| Folder import: look up ePrint versions / download ePrint PDFs | on / off |
| List import: download the ePrint PDF of each paper | on |
| List import: move papers already in the collection into the subcollections the list names (also a checkbox in the paste box) | off |
| List import: let ZotMoov move the files of moved papers | on |

The paste box, the progress window, the ePrint column and the menus are the only UI the plugin adds.

## Development

```sh
npm ci             # esbuild and TypeScript (type checking only)
npm run check      # JSDoc type check
npm run build      # build/zotero-iacr-tools-<version>.xpi
npm test           # tests (node:test); the test of the built plugin needs a build first
```

The [developer guide](docs/DEVELOPMENT.md) explains the architecture, every module, the conventions, testing, how to add commands, preferences and windows, the Zotero and ePrint facts the code relies on, releasing, and the known limitations. Coding agents start with [AGENTS.md](AGENTS.md). Changes per version are in the [changelog](CHANGELOG.md).

Releases are published by pushing a tag `vX.Y.Z` that matches `package.json` (see [Releasing](docs/DEVELOPMENT.md#releasing)).

## License

[MIT](LICENSE)
