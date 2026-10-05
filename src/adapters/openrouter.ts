import { pdfOrAudioPart, rewriteChatMessages } from "./chat-completions.ts";
import { type Build, carriesBy } from "./part-for.ts";
import { registerAdapter } from "./registry.ts";

// Keys are the MIME types that `file-type` returns; values are the format names in OpenRouter's audio guide.
// OpenRouter accepts more audio formats than OpenAI.
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

const partFor = (mimeType: string) => (videoTypes.has(mimeType) ? videoUrlPart : pdfOrAudioPart(mimeType, audioFormats));

registerAdapter({
	api: "openai-completions",
	provider: "openrouter",
	carries: carriesBy(partFor),
	rewrite: (payload, attachment) => rewriteChatMessages(payload, attachment, partFor),
});
