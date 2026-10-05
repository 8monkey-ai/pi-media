import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// These rules copy pi's `resolveReadPath`, which pi does not export, so a path finds the same file as pi's `read` tool.

function expand(path: string) {
	const spaced = path.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
	if (spaced === "~") return homedir();
	if (spaced.startsWith("~/")) return join(homedir(), spaced.slice(2));
	if (spaced.startsWith("file://")) return fileURLToPath(spaced);
	return spaced;
}

// macOS writes a narrow no-break space before AM/PM in screenshot names, stores names in NFD,
// and uses a curly apostrophe in some localized names.
function variants(path: string) {
	const decomposed = path.normalize("NFD");
	return new Set([
		path,
		path.replace(/ (AM|PM)\./gi, "\u202F$1."),
		decomposed,
		path.replaceAll("'", "\u2019"),
		decomposed.replaceAll("'", "\u2019"),
	]);
}

async function exists(path: string) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function resolveExistingPath(path: string, cwd: string) {
	let absolute: string;
	try {
		absolute = resolve(cwd, expand(path));
	} catch {
		return undefined;
	}
	for (const variant of variants(absolute)) if (await exists(variant)) return variant;
	return undefined;
}
