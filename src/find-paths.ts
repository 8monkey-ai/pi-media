import { tmpdir } from "node:os";
import { posix, win32 } from "node:path";

// Terminals insert dropped paths in the syntax of the platform's shells. On macOS and Linux that is
// backslash escapes, single quotes or double quotes. On Windows a backslash separates directories,
// and quotes group a path with spaces.
// Words end at ASCII whitespace only, because macOS screenshot names contain a narrow no-break space.
const WORD_START_RE = /(?<![^ \t\r\n([{])[^ \t\r\n]/g;
const TRAILING_PUNCTUATION_RE = /[)\],.;:!?]+$/;
const POSIX_PATH_START = String.raw`\/|~\/|\.\.?\/|file:\/\/`;
// Pi writes a pasted image to this file in os.tmpdir() and inserts its path with no quotes or spaces around it.
const PASTED_IMAGE_NAME_RE = /pi-clipboard-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(?:png|jpg|webp|gif)/g;

function syntax(pathStart: string, quotedWordPart: RegExp, bareWordPart: RegExp) {
	return {
		pathStart: new RegExp(`^(?:${pathStart})`),
		// Pi pastes copied files as raw paths, one per line, so a path that fills its line can contain spaces.
		wholeLinePath: new RegExp(String.raw`(?<=^[ \t\r]*)@?(?:${pathStart})[^\n]*?(?=[ \t\r]*$)`, "gm"),
		quotedWordPart,
		bareWordPart,
	};
}

const POSIX = syntax(
	POSIX_PATH_START,
	/'(?<literal>[^'\n]*)'|"(?<double>(?:[^"\\\n]|\\.)*)"|\\(?<escaped>.)|(?<plain>[^ \t\r\n'"\\]+)/y,
	/\\(?<escaped>.)|(?<plain>[^ \t\r\n\\]+)/y,
);
// In single quotes, PowerShell writes an apostrophe as '' and Git Bash as '\''.
// A Windows file name cannot contain a backslash, so '\'' has no other meaning.
const WINDOWS = syntax(
	String.raw`${POSIX_PATH_START}|[A-Za-z]:[\\/]|\\\\|\.\.?\\|~\\`,
	/"(?<literal>[^"\n]*)"|'(?<windowsSingle>(?:'\\''|''|[^'\n])*)'|(?<plain>[^ \t\r\n'"]+)/y,
	/(?<plain>[^ \t\r\n]+)/y,
);

type Syntax = typeof POSIX;
type WordPart = { literal?: string; double?: string; windowsSingle?: string; escaped?: string; plain?: string };

function partValue({ literal, double, windowsSingle, escaped, plain }: WordPart) {
	return literal ?? double?.replace(/\\(["\\$`])/g, "$1") ?? windowsSingle?.replace(/'\\''|''/g, "'") ?? escaped ?? plain ?? "";
}

function readWord(text: string, start: number, { quotedWordPart, bareWordPart }: Syntax) {
	const parts = text[start] === "'" || text[start] === '"' ? quotedWordPart : bareWordPart;
	parts.lastIndex = start;
	let value = "";
	let end = start;
	let plainTail = "";
	for (let match = parts.exec(text); match; match = parts.exec(text)) {
		const part: WordPart = match.groups ?? {};
		value += partValue(part);
		plainTail = part.plain ?? "";
		end = match.index + match[0].length;
	}
	const trailing = plainTail.match(TRAILING_PUNCTUATION_RE)?.[0].length ?? 0;
	return { value: value.slice(0, value.length - trailing), end: end - trailing };
}

function readCandidate(text: string, start: number, rules: Syntax) {
	const mention = text[start] === "@";
	const word = readWord(text, mention ? start + 1 : start, rules);
	if (!word.value || !(mention || rules.pathStart.test(word.value))) return [];
	return [{ start, end: word.end, path: word.value }];
}

function findWholeLineCandidates(text: string, { wholeLinePath }: Syntax) {
	return [...text.matchAll(wholeLinePath)].map(({ 0: line, index }) => ({
		start: index,
		end: index + line.length,
		path: line.replace(/^@/, ""),
	}));
}

// Pi builds the path with path.join, so the same join finds it.
function findPastedImageCandidates(text: string, tempDir: string, join: typeof posix.join) {
	return [...text.matchAll(PASTED_IMAGE_NAME_RE)].flatMap(({ 0: name, index }) => {
		const path = join(tempDir, name);
		const start = index + name.length - path.length;
		return start >= 0 && text.startsWith(path, start) ? [{ start, end: index + name.length, path }] : [];
	});
}

// Candidates can overlap; the caller keeps the first one that resolves.
// At the same start, the stable sort puts a pasted image first, then a whole line, then a word.
export function findPathCandidates(text: string, platform = process.platform, tempDir = tmpdir()) {
	const windows = platform === "win32";
	const rules = windows ? WINDOWS : POSIX;
	const words = [...text.matchAll(WORD_START_RE)].flatMap((match) => readCandidate(text, match.index, rules));
	return [
		...findPastedImageCandidates(text, tempDir, windows ? win32.join : posix.join),
		...findWholeLineCandidates(text, rules),
		...words,
	].sort((a, b) => a.start - b.start);
}
