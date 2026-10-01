/**
 * The library and collection a folder import goes into.
 *
 * Which accessors ZoteroPane offers depends on the Zotero version: the plural
 * ones (getSelectedCollections / getSelectedLibraryIDs) came with multiple
 * selection, older versions only have the singular ones. Every source is tried
 * in turn, so a missing one means a fallback rather than a silent import into
 * the library root.
 */

/** @param {() => any} fn */
function attempt(fn) {
	try {
		// ZoteroPane's menu contexts have properties that throw when they do not apply.
		return fn() ?? null;
	}
	catch {
		return null;
	}
}

const collectionOf = (row) => (row?.isCollection?.() ? row.ref ?? null : null);

/**
 * @param {any} Zotero
 * @param {any} [context] Menu context of the collection context menu, if any.
 * @returns {{ window: any, pane: any, libraryID: number, collection: any | null, source: string }}
 */
export function resolveImportTarget(Zotero, context) {
	const window = attempt(() => Zotero.getMainWindow?.());
	const pane = attempt(() => Zotero.getActiveZoteroPane?.())
		?? attempt(() => window?.ZoteroPane)
		?? attempt(() => window?.ZoteroPane_Local);

	/** @type {Array<{ name: string, get: () => any }>} */
	const sources = [
		{ name: "menu context", get: () => collectionOf(context?.collectionTreeRow) },
		{ name: "getSelectedCollections", get: () => pane?.getSelectedCollections?.()?.[0] },
		{ name: "getSelectedCollection", get: () => pane?.getSelectedCollection?.() || null },
		{ name: "selectedTreeRow", get: () => collectionOf(pane?.collectionsView?.selectedTreeRow) },
	];
	let collection = null;
	let source = "none";
	for (const { name, get } of sources) {
		collection = attempt(get);
		if (collection) {
			source = name;
			break;
		}
	}

	const libraryID = collection?.libraryID
		?? attempt(() => pane?.getSelectedLibraryIDs?.()?.[0])
		?? attempt(() => pane?.getSelectedLibraryID?.() || null)
		?? attempt(() => pane?.collectionsView?.selectedTreeRow?.ref?.libraryID)
		?? Zotero.Libraries.userLibraryID;

	return { window, pane, libraryID, collection, source };
}
