import type { ChatCompletionContentPartInputAudio } from "openai/resources/chat/completions";
import { pdfOrAudioPart, rewriteChatMessages } from "./chat-completions.ts";
import { carriesBy } from "./part-for.ts";
import { registerAdapter } from "./registry.ts";

const audioFormats = new Map<string, ChatCompletionContentPartInputAudio.InputAudio["format"]>([
	["audio/wav", "wav"],
	["audio/mpeg", "mp3"],
]);

const partFor = (mimeType: string) => pdfOrAudioPart(mimeType, audioFormats);

registerAdapter({
	api: "openai-completions",
	carries: carriesBy(partFor),
	rewrite: (payload, attachment) => rewriteChatMessages(payload, attachment, partFor),
});
