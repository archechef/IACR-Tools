/**
 * Reading and writing "Key: value" lines in Zotero's Extra field, which is the
 * sanctioned place for data that has no dedicated Zotero field.
 */

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const lineRegExp = (key) => new RegExp(`^\\s*${escapeRegExp(key)}\\s*:\\s*(.*?)\\s*$`, "im");

/** @returns {string | null} */
export function getExtraField(extra, key) {
	const match = lineRegExp(key).exec(extra ?? "");
	return match ? match[1] : null;
}

/** Sets (or replaces) a line; an empty value removes it. */
export function setExtraField(extra, key, value) {
	const lines = (extra ?? "").split(/\r?\n/);
	const re = lineRegExp(key);
	const index = lines.findIndex((line) => re.test(line));
	if (!value) {
		if (index >= 0) lines.splice(index, 1);
	}
	else if (index >= 0) {
		lines[index] = `${key}: ${value}`;
	}
	else {
		if (lines.length === 1 && lines[0] === "") lines.pop();
		lines.push(`${key}: ${value}`);
	}
	return lines.join("\n").trim();
}

export function removeExtraField(extra, key) {
	return setExtraField(extra, key, null);
}
