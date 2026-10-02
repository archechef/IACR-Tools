# Notes for coding agents

IACR Tools is a Zotero 8–10 plugin for cryptographers (Springer conversion, CryptoBib metadata, IACR ePrint versions, imports, duplicates, LaTeX). Plain JavaScript (ES modules, JSDoc types), bundled with esbuild. Read [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) before larger changes: it has the architecture, module map, how-tos, and the outside facts (Zotero APIs, ePrint, CryptoBib) the code relies on.

## Commands

```sh
npm ci            # once
npm run check     # type check; must pass
npm run build     # build/addon/ and the .xpi; needed before the tests
npm test          # all tests; the bundle test is skipped without a build
```

A change is done when `check`, `build` and `test` pass, the README describes any user-visible change, and new behaviour has a test.

## Rules of the codebase

- Constants (names, ids, URLs, preference keys and defaults, patterns, thresholds) belong in `src/config.js`. Files in `addon/` are templates: use `__PLACEHOLDERS__` (list in `scripts/build.mjs`), never hard-code `iacr-tools` / `IACRTools` there.
- `src/core` is pure: no Zotero, network or file access. `src/zotero` and `src/ui` receive `Zotero`, `http`, `files`, `prefs`, `timers`, `log` through constructors; do not use globals.
- Edit items through `ItemWrapper` (`src/zotero/item.js`); compare papers through `bestMatch` / `scoreCandidate` (`src/core/matching.js`).
- New per-item features are pipeline actions; adding one to `COMMANDS` in `src/plugin.js` puts it in the item and the collection IACR menus (Fluent ids `menu-<id>`, `progress-<id>`).
- User-visible text goes in `addon/locale/en-US/iacr-tools.ftl` (ids prefixed `iacr-tools-`; code uses the id without the prefix). In Fluent, a literal brace is `{"{"}`. The Fluent test in `test/zotero.test.js` scans a fixed list of files: add new ones that format ids.
- Plugin windows are plain HTML in `addon/content/`, opened from `chrome://iacr-tools/content/…` (`chromeURL(ASSETS.x)`); a `jar:` URL gives a blank window. State and labels come in through `window.arguments[0]`.
- Style: tabs, double quotes, short comments explaining why, a header comment per file. Match the surrounding code.

## Testing notes

- Integration tests use `test/fake-zotero.js`. When code starts using another Zotero API, add it to the fake the way Zotero behaves (check Zotero's source in `omni.ja` in the Zotero program folder if unsure).
- `test/bundle.test.js` runs the built bundle in a `vm`: compare objects created inside it as JSON (different `Array` prototype).
- Windows can only be checked visually: serve the page's `.css`/`.js` with an HTML file that sets `window.arguments = [fakeIo]` first, and look at it in light and dark mode.
- Nothing runs inside a real Zotero in the tests. Say so when reporting changes to windows, menus, bootstrap or merges.

## Git and releases

- Commit finished, passing work locally; never push, tag or release without the user's go-ahead.
- Releases: bump `package.json` (`npm version X.Y.Z --no-git-tag-version`), add a CHANGELOG entry, commit, push `main`, then push tag `vX.Y.Z`; the workflow publishes the release. Never reuse a version or move a tag that has a release.
- Commit messages: a short summary line, a body explaining what and why.
