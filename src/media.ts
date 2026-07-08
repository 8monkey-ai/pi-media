const SENTINEL_RE = /\[\[pi-media:(https?:\/\/[^\s|\]]+)\|([^\s|\]]+)\]\]/g;

export function makeSentinel(url: string, mediaType: string) {
	return `[[pi-media:${url}|${mediaType}]]`;
}

export function parseArgs(args: string) {
	const trimmed = args.trim();
	if (!trimmed) return undefined;
	const spaceIndex = trimmed.search(/\s/);
	const url = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
	const prompt = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex).trim();
	if (!/^https?:\/\//i.test(url)) return undefined;
	try {
		new URL(url);
	} catch {
		return undefined;
	}
	return { url, prompt };
}

const MIME_BY_EXTENSION: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	ogg: "audio/ogg",
	m4a: "audio/mp4",
	flac: "audio/flac",
	mp4: "video/mp4",
	webm: "video/webm",
	mov: "video/quicktime",
	pdf: "application/pdf",
	md: "text/markdown",
	markdown: "text/markdown",
	txt: "text/plain",
	csv: "text/csv",
	json: "application/json",
	html: "text/html",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function mediaTypeFromExtension(url: string) {
	const path = new URL(url).pathname;
	const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
	return MIME_BY_EXTENSION[ext];
}

async function headContentType(url: string, fetchFn: typeof fetch) {
	try {
		const res = await fetchFn(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
		const contentType = res.headers.get("content-type");
		if (!contentType) return undefined;
		return contentType.split(";")[0].trim() || undefined;
	} catch {
		return undefined;
	}
}

export async function detectMediaType(url: string, fetchFn: typeof fetch = fetch) {
	return mediaTypeFromExtension(url) ?? (await headContentType(url, fetchFn)) ?? "application/octet-stream";
}

const URL_RE = /https?:\/\/\S+/g;
const SENTINEL_PREFIX = "[[pi-media:";
// .html links in chat are usually references to browse, not attachments
const AUTO_ATTACH_EXCLUDED = new Set(["text/html"]);

export function autoAttachMedia(text: string) {
	let changed = false;
	const result = text.replace(URL_RE, (match, offset: number) => {
		if (text.slice(Math.max(0, offset - SENTINEL_PREFIX.length), offset) === SENTINEL_PREFIX) return match;
		const trailing = match.match(/[)\],.;:!?]+$/)?.[0] ?? "";
		const url = trailing ? match.slice(0, -trailing.length) : match;
		let mediaType;
		try {
			mediaType = mediaTypeFromExtension(url);
		} catch {
			return match;
		}
		if (!mediaType || AUTO_ATTACH_EXCLUDED.has(mediaType)) return match;
		changed = true;
		return makeSentinel(url, mediaType) + trailing;
	});
	return changed ? result : undefined;
}

export type ContentPart = { type: "text"; text: string } | { type: "file"; data: string; mediaType: string };

export function hasSentinel(text: string) {
	SENTINEL_RE.lastIndex = 0;
	return SENTINEL_RE.test(text);
}

export function splitTextWithSentinels(text: string): ContentPart[] {
	const parts: ContentPart[] = [];
	let last = 0;
	SENTINEL_RE.lastIndex = 0;
	for (const match of text.matchAll(SENTINEL_RE)) {
		const before = text.slice(last, match.index).trim();
		if (before) parts.push({ type: "text", text: before });
		parts.push({ type: "file", data: match[1], mediaType: match[2] });
		last = match.index + match[0].length;
	}
	const after = text.slice(last).trim();
	if (after) parts.push({ type: "text", text: after });
	return parts;
}
