#!/usr/bin/env node
/**
 * Builds the plugin:
 *   1. copies addon/ to build/addon/, filling in __PLACEHOLDERS__ from
 *      src/config.js and package.json (so names and ids are defined once);
 *   2. bundles src/index.js into a single script (esbuild, or Bun if esbuild
 *      is not installed);
 *   3. packs everything into build/<name>-<version>.xpi.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";

import { ASSETS, PLUGIN } from "../src/config.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const buildDir = join(root, "build");
const addonDir = join(buildDir, "addon");
const xpiPath = join(buildDir, `${pkg.name}-${pkg.version}.xpi`);

const PLACEHOLDERS = {
	__PLUGIN_NAME__: PLUGIN.name,
	__PLUGIN_ID__: PLUGIN.id,
	__GLOBAL_NAME__: PLUGIN.globalName,
	__CHROME_PACKAGE__: PLUGIN.chromePackage,
	__PREF_BRANCH__: PLUGIN.prefBranch,
	__L10N_PREFIX__: PLUGIN.l10nPrefix,
	__FTL__: PLUGIN.ftl,
	__BUNDLE_PATH__: ASSETS.bundle,
	__ICON__: ASSETS.icon,
	__VERSION__: pkg.version,
	__UPDATE_URL__: PLUGIN.updateURL,
	__DESCRIPTION__: pkg.description,
};
const TEMPLATED = /\.(json|js|xhtml|ftl)$/;

function* walk(dir) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) yield* walk(path);
		else yield path;
	}
}

function copyAddon() {
	rmSync(buildDir, { recursive: true, force: true });
	cpSync(join(root, "addon"), addonDir, { recursive: true });
	for (const path of walk(addonDir)) {
		if (!TEMPLATED.test(path)) continue;
		let text = readFileSync(path, "utf8");
		for (const [key, value] of Object.entries(PLACEHOLDERS)) text = text.replaceAll(key, value);
		const leftover = text.match(/__[A-Z_]+__/);
		if (leftover) throw new Error(`Unknown placeholder ${leftover[0]} in ${relative(root, path)}`);
		writeFileSync(path, text);
	}
	if (!statSync(join(addonDir, "locale", "en-US", PLUGIN.ftl), { throwIfNoEntry: false })) {
		throw new Error(`Missing locale file ${PLUGIN.ftl}`);
	}
}

async function bundle() {
	const entry = join(root, "src", "index.js");
	const outfile = join(addonDir, ASSETS.bundle);
	mkdirSync(dirname(outfile), { recursive: true });
	try {
		const esbuild = await import("esbuild");
		await esbuild.build({ entryPoints: [entry], outfile, bundle: true, format: "iife", target: "firefox140", charset: "utf8" });
	}
	catch (e) {
		if (e.code !== "ERR_MODULE_NOT_FOUND") throw e;
		execFileSync("bun", ["build", entry, "--format=iife", "--target=browser", `--outfile=${outfile}`], { stdio: "inherit" });
	}
}

// --- Minimal ZIP writer (deflate), so packaging needs no external tool. ---

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(buffer) {
	let crc = 0xFFFFFFFF;
	for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
	return (crc ^ 0xFFFFFFFF) >>> 0;
}

const DOS_EPOCH = 0x00210000;

function zip(files) {
	const locals = [];
	const centrals = [];
	let offset = 0;
	for (const { name, data } of files) {
		const nameBuffer = Buffer.from(name, "utf8");
		const compressed = deflateRawSync(data);
		const crc = crc32(data);
		const header = (signature, extra) => {
			const fields = Buffer.alloc(extra ? 46 : 30);
			fields.writeUInt32LE(signature, 0);
			let p = 4;
			if (extra) fields.writeUInt16LE(20, p), p += 2; // version made by
			fields.writeUInt16LE(20, p); // version needed
			fields.writeUInt16LE(0x0800, p + 2); // UTF-8 names
			fields.writeUInt16LE(8, p + 4); // deflate
			fields.writeUInt32LE(DOS_EPOCH, p + 6); // time 00:00, date 1980-01-01
			fields.writeUInt32LE(crc, p + 10);
			fields.writeUInt32LE(compressed.length, p + 14);
			fields.writeUInt32LE(data.length, p + 18);
			fields.writeUInt16LE(nameBuffer.length, p + 22);
			if (extra) fields.writeUInt32LE(offset, 42); // local header offset
			return fields;
		};
		const local = Buffer.concat([header(0x04034B50, false), nameBuffer, compressed]);
		centrals.push(Buffer.concat([header(0x02014B50, true), nameBuffer]));
		locals.push(local);
		offset += local.length;
	}
	const central = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054B50, 0);
	end.writeUInt16LE(files.length, 8);
	end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(central.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, central, end]);
}

function pack() {
	const files = [...walk(addonDir)].sort().map((path) => ({
		name: relative(addonDir, path).split("\\").join("/"),
		data: readFileSync(path),
	}));
	const xpi = zip(files);
	writeFileSync(xpiPath, xpi);
	console.log(`Built ${relative(root, xpiPath)} (${files.length} files)`);
	writeUpdateManifest(xpi);
}

/** The update manifest served at PLUGIN.updateURL. */
function writeUpdateManifest(xpi) {
	const { strict_min_version, strict_max_version } = JSON.parse(
		readFileSync(join(addonDir, "manifest.json"), "utf8"),
	).applications.zotero;
	const manifest = {
		addons: {
			[PLUGIN.id]: {
				updates: [{
					version: pkg.version,
					update_link: PLUGIN.xpiURL(pkg.version),
					update_hash: `sha256:${createHash("sha256").update(xpi).digest("hex")}`,
					applications: { zotero: { strict_min_version, strict_max_version } },
				}],
			},
		},
	};
	writeFileSync(join(buildDir, "updates.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
}

copyAddon();
await bundle();
pack();
