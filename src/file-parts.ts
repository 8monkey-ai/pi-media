import { basename } from "node:path";
import type { ChatCompletionContentPart, ChatCompletionContentPartInputAudio } from "openai/resources/chat/completions";
import type { Attachment } from "./media-entry.ts";

type Build = (attachment: Attachment) => unknown;

const pdfPart: Build = ({ path, data }) =>
	({
		type: "file",
		file: { filename: basename(path), file_data: `data:application/pdf;base64,${data}` },
	}) satisfies ChatCompletionContentPart.File;

// OpenRouter takes more audio formats than the OpenAI SDK type lists, so `format` is any string here.
type InputAudioPart = Omit<ChatCompletionContentPartInputAudio, "input_audio"> & {
	input_audio: Omit<ChatCompletionContentPartInputAudio.InputAudio, "format"> & { format: string };
};

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

// The OpenAI SDK has no type for `video_url` parts.
const videoUrlPart: Build = ({ mimeType, data }) => ({
	type: "video_url",
	video_url: { url: `data:${mimeType};base64,${data}` },
});

// The Chat Completions part for a file of this type, in the forms that OpenRouter documents.
function partFor(mimeType: string): Build | undefined {
	if (mimeType === "application/pdf") return pdfPart;
	if (videoTypes.has(mimeType)) return videoUrlPart;
	const format = audioFormats.get(mimeType);
	if (format === undefined) return undefined;
	return ({ data }) => ({ type: "input_audio", input_audio: { data, format } }) satisfies InputAudioPart;
}

export const carries = (mimeType: string) => partFor(mimeType) !== undefined;

export const filePart = (attachment: Attachment) => partFor(attachment.mimeType)?.(attachment);
