// Terminals insert dropped paths in shell syntax: with backslash escapes, or in single or double quotes.
// Words end at ASCII whitespace only, because macOS screenshot names contain a narrow no-break space.
const WORD_START_RE = /(?<![^ \t\r\n([{])[^ \t\r\n]/g;
const QUOTED_WORD_PART_RE = /'(?<single>[^'\n]*)'|"(?<double>(?:[^"\\\n]|\\.)*)"|\\(?<escaped>.)|(?<plain>[^ \t\r\n'"\\]+)/y;
const BARE_WORD_PART_RE = /\\(?<escaped>.)|(?<plain>[^ \t\r\n\\]+)/y;
const PATH_START = String.raw`\/|~\/|\.\.?\/|file:\/\/`;
const PATH_START_RE = new RegExp(`^(?:${PATH_START})`);
// Pi pastes copied files as raw paths, one per line, so a path that fills its line can contain spaces.
const WHOLE_LINE_PATH_RE = new RegExp(String.raw`(?<=^[ \t\r]*)@?(?:${PATH_START})[^\n]*?(?=[ \t\r]*$)`, "gm");
const TRAILING_PUNCTUATION_RE = /[)\],.;:!?]+$/;

type WordPart = { single?: string; double?: string; escaped?: string; plain?: string };

function partValue({ single, double, escaped, plain }: WordPart) {
	return single ?? double?.replace(/\\(["\\$`])/g, "$1") ?? escaped ?? plain ?? "";
}

function readWord(text: string, start: number) {
	const parts = text[start] === "'" || text[start] === '"' ? QUOTED_WORD_PART_RE : BARE_WORD_PART_RE;
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

function readCandidate(text: string, start: number) {
	const mention = text[start] === "@";
	const word = readWord(text, mention ? start + 1 : start);
	if (!word.value || !(mention || PATH_START_RE.test(word.value))) return [];
	return [{ start, end: word.end, path: word.value }];
}

function findWholeLineCandidates(text: string) {
	return [...text.matchAll(WHOLE_LINE_PATH_RE)].map(({ 0: line, index }) => ({
		start: index,
		end: index + line.length,
		path: line.replace(/^@/, ""),
	}));
}

// Candidates can overlap; the caller keeps the first one that resolves.
// The stable sort puts a whole-line candidate before the word candidate at the same start.
export function findPathCandidates(text: string) {
	const words = [...text.matchAll(WORD_START_RE)].flatMap((match) => readCandidate(text, match.index));
	return [...findWholeLineCandidates(text), ...words].sort((a, b) => a.start - b.start);
}
