import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";

// These rules copy pi's `resolveReadPath`, which pi does not export, so a path finds the same file as pi's `read` tool.

// Git Bash, MSYS, Cygwin and WSL write drive paths as /c/..., /cygdrive/c/... or /mnt/c/...
function toWindowsDrivePath(path: string) {
	if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return path;
	const match = path.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
	if (!match) return path;
	return `${match[1].toUpperCase()}:\\${match[2]?.replaceAll("/", "\\") ?? ""}`;
}

const POSIX = { path: posix, windows: false, toNativePath: (path: string) => path, homePrefixes: ["~/"] };
const WINDOWS = { path: win32, windows: true, toNativePath: toWindowsDrivePath, homePrefixes: ["~/", "~\\"] };

type Rules = typeof POSIX;

function normalize(path: string, { path: paths, windows, toNativePath, homePrefixes }: Rules) {
	const native = toNativePath(path);
	if (native === "~") return homedir();
	if (homePrefixes.some((prefix) => native.startsWith(prefix))) return paths.join(homedir(), native.slice(2));
	if (native.startsWith("file://")) return fileURLToPath(native, { windows });
	return native;
}

// Returns the absolute path pi's `read` tool would use, before it tries the file name variants.
export function resolvePath(path: string, cwd: string, platform = process.platform) {
	const rules = platform === "win32" ? WINDOWS : POSIX;
	const spaced = path.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
	const expanded = normalize(spaced.startsWith("@") ? spaced.slice(1) : spaced, rules);
	const { isAbsolute, resolve } = rules.path;
	return isAbsolute(expanded) ? resolve(expanded) : resolve(normalize(cwd, rules), expanded);
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
		absolute = resolvePath(path, cwd);
	} catch {
		return undefined;
	}
	for (const variant of variants(absolute)) if (await exists(variant)) return variant;
	return undefined;
}
