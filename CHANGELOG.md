# Changelog

All releases are on [GitHub](https://github.com/archechef/IACR-Tools/releases); installed copies update themselves.

## 1.5.0 — 2026-10-02

- **Lists with sections**: in Add Papers from a List, a line `[Topic]` or `[Topic / Subtopic]` files the papers below it into that subcollection of the selected collection, created when missing. A section may repeat the selected collection's path (`[Phd → Project → Topic]`); a paper listed in two sections goes into both.
- **Reorganizing**: a new checkbox in the paste box moves papers already in the selected collection into the subcollections the list names, out of the others below it. Collections outside it and papers the list does not name are left alone.
- With ZotMoov installed and set to move files, the files of moved papers follow them into their new collection's folder (preference, on by default).
- Copy Papers as List on a collection writes a section per subcollection, so the list imports back with its structure.

## 1.4.1 — 2026-10-01

- Right-click a collection → **IACR**: every paper command (Springer conversion, CryptoBib update, ePrint lookup and download, revision check, preprint update, version links, all of the above), plus Copy Papers as List, Copy LaTeX Citation, Export BibTeX and Find Duplicate Papers. They apply to the collection's papers, including subcollections when Zotero shows their items; on a library, to all its papers after a confirmation. The collection entries that were at the top level moved into this submenu.

## 1.4.0 — 2026-10-01

- **Duplicate papers across versions**: Tools → Find Duplicate Papers… (also on collections and the selected papers) reports papers that are probably the same paper, by DOI, ePrint id, or title and authors. Copies can be merged with Zotero's own merge; versions (ePrint, conference, journal) linked as related items.
- **Update Preprints to Published Versions**: a preprint that CryptoBib lists as published gets the published metadata and type, keeping its ePrint id and PDF; if the published version is already in the library, the two are linked instead.
- **Link ePrint and Published Versions** as related items.
- **Check for Revised ePrint Versions**: fetches the new PDF when the ePrint page was revised after the attached one; the old PDF keeps its date (or goes to the trash).
- **Copy LaTeX Citation** (`\cite` with CryptoBib keys) and **Export BibTeX of Papers Not in CryptoBib…**, for use next to `crypto.bib`.
- Preferences: papers fetched at the same time, progress window on/off, automatic preprint updates and version links for new items, replacing revised ePrint PDFs.

## 1.3.3 — 2026-10-01

- Fixed: the paste box of Add Papers from a List opened as a blank grey window (the plugin's windows are now opened from a registered `chrome://` package).
- Long runs (list import, folder import, menu commands) report in a resizable window listing every paper, with a "Show only problems" filter, Stop and Close.

## 1.3.2 — 2026-10-01

- The list import and the menu commands look up and download several papers at once (4); a paper listed twice is still added and downloaded once.

## 1.3.1 — 2026-10-01

- Fixed: Enter on a focused button of the paste box added the list.
- Fixed: a failure while reading the library could leave automatic processing switched off until restart.
- Fixed: an empty line in Extra (e.g. `Citation Key:`) took the value of the next line.
- Matching against large libraries is about 60 times faster.
- A broken CryptoBib download (an error page, a truncated file) no longer replaces the good copy.
- Update URLs point to the GitHub releases.

## 1.3.0

- First version in this repository: Springer conversion, CryptoBib metadata, ePrint lookup and download, folder import, list import and export.
