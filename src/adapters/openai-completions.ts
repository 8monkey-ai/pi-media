import { pdfOrAudioPart, rewriteChatMessages } from "./chat-completions.ts";
import { carriesBy } from "./part-for.ts";
import { registerAdapter } from "./registry.ts";

const audioFormats = new Map([
	["audio/wav", "wav"],
	["audio/mpeg", "mp3"],
]);

const partFor = (mimeType: string) => pdfOrAudioPart(mimeType, audioFormats);

registerAdapter({
	api: "openai-completions",
	carries: carriesBy(partFor),
	rewrite: (payload, attachment) => rewriteChatMessages(payload, attachment, partFor),
});
