import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { rewrite } from "./chat-completions.ts";
import { readMaxAttachmentBytes } from "./config.ts";
import { markContext } from "./context.ts";
import { carries } from "./file-parts.ts";
import { findLocalMedia } from "./media.ts";
import { ENTRY_TYPE, findAttachment, type MediaEntryData } from "./media-entry.ts";
import { createMediaReadTool } from "./read-tool.ts";

// Only the Chat Completions API gets files. Other APIs, and virtual models that hide the API that answers, get the path
// as text.
const takesFiles = (model: Model<Api> | undefined): model is Model<"openai-completions"> => model?.api === "openai-completions";

// After the input hook, pi expands `/skill:<name>`, with the name up to the first space, and `/<template>`, with the
// name up to the first whitespace. No entry links to the expanded text.
function expandsCommand(text: string, commands: SlashCommandInfo[]) {
	const skill = text.startsWith("/skill:") ? text.slice(1).split(" ")[0] : undefined;
	const template = /^\/(\S+)/.exec(text)?.[1];
	return commands.some(
		({ source, name }) => (source === "skill" && name === skill) || (source === "prompt" && name === template),
	);
}

export default function (pi: ExtensionAPI) {
	const maxAttachmentBytes = readMaxAttachmentBytes();
	pi.registerTool(createMediaReadTool(() => pi.getSettings().images?.autoResize, maxAttachmentBytes));

	pi.on("input", async (event, ctx) => {
		const { images, attachments } = await findLocalMedia(event.text, ctx.cwd, maxAttachmentBytes);
		if (attachments.length > 0 && !expandsCommand(event.text, pi.getCommands())) {
			pi.appendEntry(ENTRY_TYPE, { text: event.text, attachments } satisfies MediaEntryData);
		}
		if (images.length === 0) return { action: "continue" };
		return { action: "transform", text: event.text, images: [...(event.images ?? []), ...images] };
	});

	pi.on("context", (event, ctx) =>
		markContext(event.messages, ctx.sessionManager.getBranch(), takesFiles(ctx.model) ? carries : undefined),
	);

	pi.on("before_provider_request", (event, ctx) => {
		if (!takesFiles(ctx.model)) return undefined;
		return rewrite(
			event.payload,
			(entryId, index) => findAttachment(ctx.sessionManager.getEntry(entryId), index),
			ctx.model.compat?.requiresAssistantAfterToolResult === true,
		);
	});
}
