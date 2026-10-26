import { basename } from "node:path";
import type { Attachment } from "./media-entry.ts";

type Build = (attachment: Attachment) => unknown;

const pdfPart: Build = ({ path, data }) => ({
	type: "file",
	file: { filename: basename(path), file_data: `data:application/pdf;base64,${data}` },
});

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

const videoUrlPart: Build = ({ mimeType, data }) => ({
	type: "video_url",
	video_url: { url: `data:${mimeType};base64,${data}` },
});

// Pi gives images to the main model as image content. Only a call to an image model puts an image in a marker.
const imageUrlPart: Build = ({ mimeType, data }) => ({
	type: "image_url",
	image_url: { url: `data:${mimeType};base64,${data}` },
});

// The Chat Completions part for a file of this type, in the forms that OpenRouter documents.
function partFor(mimeType: string): Build | undefined {
	if (mimeType === "application/pdf") return pdfPart;
	if (videoTypes.has(mimeType)) return videoUrlPart;
	if (mimeType.startsWith("image/")) return imageUrlPart;
	const format = audioFormats.get(mimeType);
	if (format === undefined) return undefined;
	return ({ data }) => ({ type: "input_audio", input_audio: { data, format } });
}

export const carries = (mimeType: string) => partFor(mimeType) !== undefined;

export const filePart = (attachment: Attachment) => partFor(attachment.mimeType)?.(attachment);
