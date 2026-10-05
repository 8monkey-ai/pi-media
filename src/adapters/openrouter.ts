import type { Attachment } from "../media-entry.ts";
import { inputAudioPart, pdfFilePart, rewriteChatMessages } from "./openai-completions.ts";
import { registerAdapter } from "./registry.ts";

// Keys are the MIME types that `file-type` returns; values are the format names in OpenRouter's audio guide.
const audioFormats = new Map([
	["audio/wav", "wav"],
	["audio/mpeg", "mp3"],
	["audio/aiff", "aiff"],
	["audio/aac", "aac"],
	["audio/ogg", "ogg"],
	["audio/flac", "flac"],
	["audio/x-m4a", "m4a"],
]);

const videoTypes = new Set(["video/mp4", "video/mpeg", "video/webm"]);

function part(attachment: Attachment) {
	const { mimeType, data } = attachment;
	if (mimeType === "application/pdf") return pdfFilePart(attachment);
	if (videoTypes.has(mimeType)) return { type: "video_url", video_url: { url: `data:${mimeType};base64,${data}` } };
	const format = audioFormats.get(mimeType);
	return format && inputAudioPart(data, format);
}

registerAdapter({
	api: "openai-completions",
	provider: "openrouter",
	carries: (mimeType) => mimeType === "application/pdf" || videoTypes.has(mimeType) || audioFormats.has(mimeType),
	rewrite: (payload, attachment) => rewriteChatMessages(payload, attachment, part),
});
