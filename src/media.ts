import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { detectSupportedImageMimeTypeFromFile, type InputEvent } from "@earendil-works/pi-coding-agent";

type ImageContent = NonNullable<InputEvent["images"]>[number];

const MARKER_RE = /\[\[pi-media:([^|\]]+)\|([^|\]]+)\]\]/g;

// Audio, video and document types Gemini models accept. Images go to pi's own image handling.
// Everything else stays plain text for pi's read tool.
// https://ai.google.dev/gemini-api/docs/generate-content/{audio,video,document}-understanding
const MIME_BY_EXTENSION: Record<string, string> = {
	wav: "audio/wav",
	mp3: "audio/mpeg",
	aac: "audio/aac",
	flac: "audio/flac",
	ogg: "audio/ogg",
	aiff: "audio/aiff",
	aif: "audio/aiff",
	mp4: "video/mp4",
	mov: "video/quicktime",
	webm: "video/webm",
	mpeg: "video/mpeg",
	mpg: "video/mpeg",
	avi: "video/avi",
	wmv: "video/wmv",
	flv: "video/x-flv",
	"3gp": "video/3gpp",
	pdf: "application/pdf",
};

// ponytail: files above this are left as plain @paths — base64 in memory would risk an OOM.
// Raise it, or upload and send a URL instead, if large video matters.
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const AT_PATH_RE = /(?:^|[\s([{])@(?:"([^"]+)"|(\S+))/g;
const TRAILING_PUNCTUATION_RE = /[)\],.;:!?]+$/;

export function makeMarker(path: string, mediaType: string) {
	return `[[pi-media:${path}|${mediaType}]]`;
}

function mediaTypeFromExtension(path: string) {
	return MIME_BY_EXTENSION[path.slice(path.lastIndexOf(".") + 1).toLowerCase()];
}

async function isAttachable(path: string) {
	try {
		const stats = await stat(path);
		return stats.isFile() && stats.size > 0 && stats.size <= MAX_ATTACHMENT_BYTES;
	} catch {
		return false;
	}
}

async function readImage(path: string): Promise<ImageContent | undefined> {
	try {
		const mimeType = await detectSupportedImageMimeTypeFromFile(path);
		if (!mimeType) return undefined;
		return { type: "image", data: (await readFile(path)).toString("base64"), mimeType };
	} catch {
		return undefined;
	}
}

export async function attachLocalMedia(text: string, cwd: string) {
	let result = "";
	let last = 0;
	const images: ImageContent[] = [];
	for (const match of text.matchAll(AT_PATH_RE)) {
		const quoted = match[1];
		const trailing = quoted ? "" : (match[2].match(TRAILING_PUNCTUATION_RE)?.[0] ?? "");
		const mention = quoted ?? match[2].slice(0, match[2].length - trailing.length);
		const path = resolve(cwd, mention);
		if (!(await isAttachable(path))) continue;
		const image = await readImage(path);
		if (image) {
			images.push(image);
			continue;
		}
		const mediaType = mediaTypeFromExtension(mention);
		if (!mediaType) continue;
		result += text.slice(last, match.index + match[0].indexOf("@")) + makeMarker(path, mediaType) + trailing;
		last = match.index + match[0].length;
	}
	if (last === 0 && images.length === 0) return undefined;
	return { text: result + text.slice(last), images };
}

type MediaSegment = { type: "text"; text: string } | { type: "media"; path: string; mediaType: string };

export function splitMarkers(text: string): MediaSegment[] {
	const segments: MediaSegment[] = [];
	let last = 0;
	for (const match of text.matchAll(MARKER_RE)) {
		const before = text.slice(last, match.index).trim();
		if (before) segments.push({ type: "text", text: before });
		segments.push({ type: "media", path: match[1], mediaType: match[2] });
		last = match.index + match[0].length;
	}
	const after = text.slice(last).trim();
	if (after) segments.push({ type: "text", text: after });
	return segments;
}
