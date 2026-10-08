## IACR submenu (items and collections)

iacr-tools-menu-root =
    .label = IACR
iacr-tools-menu-process-all =
    .label = Update All
iacr-tools-menu-group-metadata =
    .label = Metadata
iacr-tools-menu-sync-cryptobib =
    .label = Update from CryptoBib
iacr-tools-menu-convert-springer =
    .label = Springer Chapter → Conference Paper
iacr-tools-menu-upgrade-preprints =
    .label = Preprint → Published Version
iacr-tools-menu-group-eprint =
    .label = ePrint & PDFs
iacr-tools-menu-find-eprint =
    .label = Find ePrint Version
iacr-tools-menu-download-eprint =
    .label = Download ePrint PDF
iacr-tools-menu-download-doi-pdf =
    .label = Download PDF via DOI (Papers Without ePrint Version)
iacr-tools-menu-download-in-browser =
    .label = Download Missing PDFs in Browser…
iacr-tools-menu-check-eprint-revisions =
    .label = Check for Revised PDF
iacr-tools-menu-open-eprint =
    .label = Open ePrint Page
iacr-tools-menu-group-versions =
    .label = Duplicates & Versions
iacr-tools-menu-find-duplicates =
    .label = Find Duplicates…
iacr-tools-menu-link-versions =
    .label = Link ePrint and Published Versions
iacr-tools-menu-group-export =
    .label = Copy & Export
iacr-tools-menu-copy-list =
    .label = Copy as List
iacr-tools-menu-copy-latex =
    .label = Copy LaTeX Citation
iacr-tools-menu-export-bibtex =
    .label = Export BibTeX (Not in CryptoBib)…
iacr-tools-menu-group-add =
    .label = Add Papers
iacr-tools-menu-add-list-here =
    .label = From a List…
iacr-tools-menu-import-folder-here =
    .label = From a Folder of PDFs…
iacr-tools-menu-link-project-folder =
    .label = Link Project Folder…

## File menu

iacr-tools-menu-import-folder =
    .label = Import PDFs from Folder…
iacr-tools-menu-add-list =
    .label = Add Papers from a List…

## Tools menu

iacr-tools-menu-update-cryptobib =
    .label = Update CryptoBib Database
iacr-tools-menu-find-library-duplicates =
    .label = Find Duplicate Papers…

## Progress window

iacr-tools-progress-convert-springer = Converting Springer chapters
iacr-tools-progress-sync-cryptobib = Updating metadata from CryptoBib
iacr-tools-progress-find-eprint = Finding ePrint versions
iacr-tools-progress-download-eprint = Downloading ePrint PDFs
iacr-tools-progress-download-doi-pdf = Downloading PDFs via the DOI
iacr-tools-progress-download-in-browser = Downloading PDFs in your browser
iacr-tools-progress-check-eprint-revisions = Checking for revised ePrint versions
iacr-tools-progress-upgrade-preprints = Updating preprints to published versions
iacr-tools-progress-link-versions = Linking ePrint and published versions
iacr-tools-progress-process-all = Processing items
iacr-tools-progress-update-cryptobib = Updating CryptoBib
iacr-tools-progress-summary = { $changed } updated, { $unchanged } unchanged, { $skipped } skipped, { $failed } failed
iacr-tools-progress-failed = The operation failed.
iacr-tools-progress-stop = Stop
iacr-tools-progress-stopping = Stopping…
iacr-tools-progress-stopped = Stopped; the remaining papers were left alone.
iacr-tools-progress-close = Close
iacr-tools-progress-problems-only = Show only problems
iacr-tools-progress-no-problems = No problems.
iacr-tools-progress-outcome-done = Done
iacr-tools-progress-outcome-problems = Done, with problems
iacr-tools-progress-outcome-stopped = Stopped
iacr-tools-progress-outcome-failed = Failed

iacr-tools-status-changed = updated
iacr-tools-status-unchanged = unchanged
iacr-tools-status-skipped = skipped
iacr-tools-status-failed = failed

iacr-tools-store-downloading = Downloading CryptoBib (about 40 MB)…
iacr-tools-store-indexing = Indexing CryptoBib…
iacr-tools-store-ready = CryptoBib is ready.
iacr-tools-store-failed = CryptoBib is unavailable; only online sources will be used.
iacr-tools-store-updated = CryptoBib updated: { $count } entries.

## Folder import

iacr-tools-import-title = Import PDFs from Folder
iacr-tools-import-pick-folder = Choose a folder of PDFs to import
iacr-tools-import-read-only = The selected library is read-only.
iacr-tools-import-scanning = Looking for PDFs and comparing them with your library…
iacr-tools-import-running = Importing { $count ->
        [one] one PDF
       *[other] { $count } PDFs
    }…
iacr-tools-import-nothing-new = “{ $folder }” and its subfolders contain { $total ->
        [one] one PDF
       *[other] { $total } PDFs
    }, and your library already has { $total ->
        [one] it.
       *[other] all of them.
    }
iacr-tools-import-confirm = “{ $folder }” and its subfolders contain { $total ->
        [one] one PDF
       *[other] { $total } PDFs
    }. { $exists ->
        [0] { "" }
        [one] One is already in your library.
       *[other] { $exists } are already in your library.
    } { $repeat ->
        [0] { "" }
        [one] One is a copy of another file in the folder.
       *[other] { $repeat } are copies of other files in the folder.
    }
    Import { $new ->
        [one] the remaining PDF
       *[other] the remaining { $new } PDFs
    } into “{ $target }”? Metadata is retrieved for each PDF; papers that turn out to be in your library already are skipped.
iacr-tools-import-accept = Import
iacr-tools-import-find-eprint = Look up the IACR ePrint version of each imported paper
iacr-tools-progress-import-folder = Importing PDFs from folder
iacr-tools-import-status-imported = imported
iacr-tools-import-status-attached = PDF added to the existing item
iacr-tools-import-status-exists = already in library
iacr-tools-import-status-repeat = copy of another file
iacr-tools-import-status-unrecognized = imported without metadata
iacr-tools-import-status-failed = failed
iacr-tools-import-summary = { $imported } imported, { $attached } added to existing items, { $exists } already in library, { $repeat } copies skipped, { $unrecognized } without metadata, { $failed } failed

## Reading lists

iacr-tools-list-title = Add Papers from a List
iacr-tools-list-pick-file = Choose a list of papers
iacr-tools-list-empty = No papers were found in that file. Each line should hold an ePrint id (2024/1234), a DOI, a CryptoBib key or a paper title.
iacr-tools-list-confirm = { $count ->
        [one] One paper was
       *[other] { $count } papers were
    } found in the list. Add { $count ->
        [one] it
       *[other] them
    } to “{ $target }”? Papers that are already in your library are left alone.
iacr-tools-list-dialog-description = One paper per line: an ePrint id (2024/1234), a DOI, a CryptoBib key or a title. Text after # is a comment. Papers are added to “{ $target }”; those already in your library are left alone. A line such as [Topic] or [Topic / Subtopic] puts the papers below it into that subcollection, created if needed.
iacr-tools-list-cancel = Cancel
iacr-tools-list-accept = Add Papers
iacr-tools-list-choose-file = Use a File Instead…
iacr-tools-list-download-pdf = Download the ePrint PDF of each paper
iacr-tools-list-reorganize = Move papers already in “{ $target }” into the subcollections the list names
iacr-tools-list-running = Looking up { $count ->
        [one] one paper
       *[other] { $count } papers
    }…
iacr-tools-progress-add-list = Adding papers from a list
iacr-tools-list-status-added = added
iacr-tools-list-status-updated = already in library, updated
iacr-tools-list-status-moved = already in library, moved
iacr-tools-list-status-exists = already in library
iacr-tools-list-status-not-found = not found
iacr-tools-list-status-failed = failed
iacr-tools-list-summary = { $added } added, { $updated } updated, { $moved } moved, { $exists } already in library, { $notFound } not found, { $failed } failed
iacr-tools-list-moving-files = ZotMoov is moving the files of { $count ->
        [one] one paper
       *[other] { $count } papers
    }…

## Copying papers out

iacr-tools-copy-title = Copy as List
iacr-tools-copy-header = Papers from Zotero: { $source }
iacr-tools-copy-empty = The selection holds no papers to copy.
iacr-tools-copy-no-collection = Select a collection first.
iacr-tools-progress-copy-list = Copying papers as a list
iacr-tools-copy-summary = { $count ->
        [one] One paper copied to the clipboard.
       *[other] { $count } papers copied to the clipboard.
    } Paste it wherever you need it; “Add Papers from a List…” reads it back.

## LaTeX

iacr-tools-latex-title = Copy LaTeX Citation
iacr-tools-latex-no-keys = None of the selected papers has a citation key.
iacr-tools-progress-copy-latex = Copying a LaTeX citation
iacr-tools-latex-copied = { $count ->
        [one] A \cite command with one key was copied to the clipboard.
       *[other] A \cite command with { $count } keys was copied to the clipboard.
    }{ $others ->
        [0] {""}
        [one] {" "}One paper is not in CryptoBib; export it with “Export BibTeX of Papers Not in CryptoBib…”.
       *[other] {" "}{ $others } papers are not in CryptoBib; export them with “Export BibTeX of Papers Not in CryptoBib…”.
    }{ $missing ->
        [0] {""}
       *[other] {" "}{ $missing } without a key were left out.
    }
iacr-tools-latex-export-title = Export BibTeX of Papers Not in CryptoBib
iacr-tools-latex-export-header = Papers that CryptoBib does not have, exported by IACR Tools on { $date }.
    Use this file next to CryptoBib, e.g. \bibliography{"{"}{ $abbrev },crypto,{ $file }{"}"}
iacr-tools-latex-export-nothing = { $count ->
        [0] The selection holds no papers.
        [one] CryptoBib has the selected paper; crypto.bib covers it.
       *[other] CryptoBib has all { $count } papers; crypto.bib covers them.
    }
iacr-tools-progress-export-bibtex = Exporting BibTeX
iacr-tools-latex-exported = { $count ->
        [one] One paper was exported
       *[other] { $count } papers were exported
    }{ $inCryptoBib ->
        [0] .
       *[other] ; { $inCryptoBib } others are in CryptoBib.
    }

## Linking a project folder

iacr-tools-project-title = Link Project Folder
iacr-tools-project-no-collection = Right-click the project's collection to link a project folder to it.
iacr-tools-project-pick-folder = Choose the project folder for “{ $name }”
iacr-tools-project-confirm = Link the project folder { $folder } to the collection “{ $name }”?
iacr-tools-project-accept = Link
iacr-tools-project-nothing-to-do = Nothing to do for { $folder } and “{ $name }”:
iacr-tools-project-name-differs = Note: the folder is called “{ $folder }”, the collection “{ $name }”.
iacr-tools-project-papers-create = PDFs: { $link } becomes a link to ZotMoov's folder { $target }, so the PDFs of “{ $name }” appear in the project.
iacr-tools-project-papers-replace = PDFs: the empty folder { $link } is replaced by a link to ZotMoov's folder { $target }, so the PDFs of “{ $name }” appear in the project.
iacr-tools-project-papers-linked = PDFs: { $link } already shows ZotMoov's folder { $target }.
iacr-tools-project-papers-occupied = PDFs: { $link } already exists and does not show ZotMoov's folder { $target }. It is left alone; move it away (or empty it) to link it.
iacr-tools-project-papers-unavailable = PDFs: no link, { $reason }
iacr-tools-project-zotmoov-missing = because ZotMoov is not installed.
iacr-tools-project-zotmoov-no-folder = because ZotMoov has no directory set (Settings → ZotMoov).
iacr-tools-project-zotmoov-subfolders = because ZotMoov does not file PDFs in a folder per collection: in Settings → ZotMoov, turn on subdirectories with {"{"}%c{"}"}.
iacr-tools-project-bib-create = Bibliography: Better BibTeX keeps { $path } updated with the papers of “{ $name }”.
iacr-tools-project-bib-replace = Bibliography: Better BibTeX keeps { $path } updated with the papers of “{ $name }”. The file that is there now is overwritten.
iacr-tools-project-bib-exported = Bibliography: Better BibTeX already keeps { $path } updated with “{ $name }”.
iacr-tools-project-bib-occupied = Bibliography: Better BibTeX already exports something else to { $path }. It is left alone; remove that export under Settings → Better BibTeX → Automatic Export to link it.
iacr-tools-project-bib-unavailable = Bibliography: not kept updated, because Better BibTeX is not installed.
iacr-tools-project-papers-created = { $link } now shows ZotMoov's folder { $target }.
iacr-tools-project-papers-failed = The link { $link } could not be created: { $error }
iacr-tools-project-bib-created = Better BibTeX now keeps { $path } updated with “{ $name }”; it writes the file in a moment.
iacr-tools-project-bib-failed = The export to { $path } could not be set up: { $error }

## Commands on a collection or library

iacr-tools-collection-empty = “{ $name }” holds no papers.
iacr-tools-collection-confirm-library = { $action }: this applies to all { $count } papers in “{ $name }”. Continue?
iacr-tools-collection-run = Continue

## Duplicate papers

iacr-tools-dup-title = Duplicate Papers
iacr-tools-progress-find-duplicates = Looking for duplicate papers
iacr-tools-dup-scanning = Comparing the papers of the library…
iacr-tools-dup-selection = { $count ->
        [one] the selected paper
       *[other] the { $count } selected papers
    }
iacr-tools-dup-headline = Duplicate papers: { $where }
iacr-tools-dup-status = { $papers } papers compared. { $groups ->
        [one] One group of papers is probably the same paper.
       *[other] { $groups } groups of papers are probably the same paper.
    } Copies of one publication can be merged; an ePrint preprint can be merged into its published version, and versions (ePrint, conference, journal) can be linked as related items.
iacr-tools-dup-nothing = No duplicate papers were found among { $papers } papers.
iacr-tools-dup-no-window = { $groups } groups of duplicate papers were found, but the report window could not be opened.
iacr-tools-dup-close = Close
iacr-tools-dup-link-all = Link All Versions
iacr-tools-dup-none = Nothing left to report.
iacr-tools-dup-untitled = (untitled)
iacr-tools-dup-attachments = { $count ->
        [one] one attachment
       *[other] { $count } attachments
    }
iacr-tools-dup-copies = Copies
iacr-tools-dup-versions = Versions
iacr-tools-dup-show = Show in Library
iacr-tools-dup-keep-which = { $count } copies of one publication. Keep:
iacr-tools-dup-merge = Merge { $count } Copies
iacr-tools-dup-link = Link Versions
iacr-tools-dup-dismiss = Not the Same Paper
iacr-tools-dup-merged = Merged into “{ $title }”; the other copies are in the trash.
iacr-tools-dup-linked = Versions linked as related items.
iacr-tools-dup-linked-badge = Linked
iacr-tools-dup-merge-versions = Merge into One Item
iacr-tools-dup-merge-into = Keep the published version:
iacr-tools-dup-merged-versions = The preprint was merged into “{ $title }” (its PDF, notes and tags moved there; the ePrint id is kept in Extra). The preprint is in the trash.
iacr-tools-dup-dismissed = Marked as different papers; this group will not be reported again.

## Item tree

iacr-tools-column-eprint = ePrint

## Preferences

iacr-tools-pref-auto-heading = New Items
iacr-tools-pref-auto-description = Applied automatically to items you add (for example with the Zotero Connector).
iacr-tools-pref-auto-convert =
    .label = Save Springer conference papers as “Conference Paper”
iacr-tools-pref-auto-sync =
    .label = Update metadata from CryptoBib
iacr-tools-pref-auto-find =
    .label = Look up the ePrint version
iacr-tools-pref-auto-download =
    .label = Download the ePrint PDF
iacr-tools-pref-auto-doi-pdf =
    .label = Download the PDF via the DOI when there is no ePrint version (Zotero’s Find Full Text)
iacr-tools-pref-auto-upgrade =
    .label = Turn preprints that CryptoBib lists as published into the published paper
iacr-tools-pref-auto-link =
    .label = Link the ePrint and the published version as related items

iacr-tools-pref-cryptobib-heading = CryptoBib
iacr-tools-pref-overwrite =
    .label = Overwrite existing fields with CryptoBib values
iacr-tools-pref-replace-creators =
    .label = Replace authors and editors with CryptoBib’s names
iacr-tools-pref-abbrev = Venue names:
iacr-tools-pref-abbrev-0 =
    .label = Full (abbrev0)
iacr-tools-pref-abbrev-1 =
    .label = Abbreviated (abbrev1)
iacr-tools-pref-abbrev-2 =
    .label = Short (abbrev2)
iacr-tools-pref-abbrev-3 =
    .label = Shortest (abbrev3)
iacr-tools-pref-max-age = Refresh CryptoBib after (days, 0 = never):
iacr-tools-pref-base-url = Download location:
iacr-tools-pref-update-now =
    .label = Update CryptoBib Now

iacr-tools-pref-eprint-heading = IACR ePrint
iacr-tools-pref-online-search =
    .label = Search dblp and eprint.iacr.org when CryptoBib has no match
iacr-tools-pref-extra-key = Extra field key:
iacr-tools-pref-extra-key-description = The ePrint id is stored in the Extra field as “<key>: YYYY/NNN” and shown in the “ePrint” column.
iacr-tools-pref-replace-revised =
    .label = When a revised ePrint PDF is downloaded, move the old one to the trash (otherwise it is kept with its date)

iacr-tools-pref-general-heading = Running Commands
iacr-tools-pref-concurrency = Papers fetched at the same time (1–8):
iacr-tools-pref-progress-window =
    .label = Show the progress of imports and commands in a window of their own
iacr-tools-pref-collections-recursive =
    .label = Commands on a collection also apply to the papers in its subcollections

iacr-tools-pref-import-heading = Import PDFs from Folder
iacr-tools-pref-import-description = File → Import PDFs from Folder… (or right-click a collection) imports the PDFs of a folder and its subfolders that are not in the library yet. New items are converted and updated from CryptoBib according to the settings above.
iacr-tools-pref-import-subcollections =
    .label = Create a collection for the folder and each subfolder
iacr-tools-pref-import-link =
    .label = Link to the files instead of copying them into Zotero (My Library only)
iacr-tools-pref-import-attach =
    .label = Add the PDF to the existing item when the paper is in the library without a PDF
iacr-tools-pref-import-find-eprint =
    .label = Look up the ePrint version of each imported paper
iacr-tools-pref-import-download-eprint =
    .label = Also download the ePrint PDF

iacr-tools-pref-list-heading = Add Papers from a List
iacr-tools-pref-list-description = File → Add Papers from a List… reads a list of papers from the clipboard or a file: one ePrint id (2024/1234), DOI, CryptoBib key (EC:Bernstein08) or paper title per line, or a BibTeX bibliography. Lines starting with # are ignored. A line [Topic] or [Topic / Subtopic] files the papers below it in that subcollection of the selected collection.
iacr-tools-pref-list-download =
    .label = Download the ePrint PDF of each paper added from a list
iacr-tools-pref-list-doi-pdf =
    .label = When downloading, fetch the PDF via the DOI for papers without an ePrint version

iacr-tools-pref-browser-heading = Download Missing PDFs in Browser
iacr-tools-pref-browser-description = For sites that only let web browsers download PDFs, such as the IACR ePrint archive and the ACM Digital Library: the plugin opens the papers' PDF links in your browser and attaches the PDFs you save to this folder.
iacr-tools-pref-browser-folder = Folder your browser saves downloads to (empty: your Downloads folder):

## Downloading in the browser

iacr-tools-browser-title = Download Missing PDFs in Browser
iacr-tools-browser-nothing = None of these papers is missing a PDF that the browser could fetch: this is for papers without a PDF that have an ePrint version or a DOI.
iacr-tools-browser-no-folder = The folder your browser saves downloads to was not found{ $folder ->
        [none] {""}
       *[other] {" "}({ $folder })
    }. Set it in Settings → IACR Tools → Download Missing PDFs in Browser.
iacr-tools-browser-confirm = Open the PDF links of { $count ->
        [one] one paper
       *[other] { $count } papers
    } in your web browser, { $tabs } at a time? Save each PDF there as you normally would, to { $folder }. While the progress window is open, every new PDF in that folder is attached to its paper and the next link opens; Stop ends the waiting.
iacr-tools-browser-accept = Open in Browser
iacr-tools-browser-waiting = Waiting for { $count ->
        [one] one PDF
       *[other] { $count } PDFs
    } in { $folder }. Save each PDF from your browser.
iacr-tools-browser-status-attached = PDF attached
iacr-tools-browser-status-missing = not downloaded
iacr-tools-browser-status-failed = could not be attached
iacr-tools-browser-status-unmatched = not matched to a paper; drag it onto its paper
iacr-tools-browser-summary = { $attached } attached, { $missing } not downloaded, { $unmatched } files not matched, { $failed } failed
iacr-tools-pref-list-reorganize =
    .label = Move papers already in the selected collection into the subcollections the list names
iacr-tools-pref-list-zotmoov =
    .label = Let ZotMoov move the files of papers moved between collections (when ZotMoov is installed and set to move files)
