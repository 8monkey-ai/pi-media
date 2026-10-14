import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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

export default function (pi: ExtensionAPI) {
	const maxAttachmentBytes = readMaxAttachmentBytes();
	pi.registerTool(createMediaReadTool(() => pi.getSettings().images?.autoResize, maxAttachmentBytes));

	pi.on("input", async (event, ctx) => {
		const { images, attachments } = await findLocalMedia(event.text, ctx.cwd, maxAttachmentBytes);
		if (attachments.length > 0) {
			pi.appendEntry(ENTRY_TYPE, { text: event.text, attachments } satisfies MediaEntryData);
		}
		if (images.length === 0) return { action: "continue" };
		return { action: "transform", text: event.text, images: [...(event.images ?? []), ...images] };
	});

	// The files of tool results go in a user message after the tool messages. A model that needs an assistant message
	// after tool results gets no files from tool results, so that pi-media does not add an assistant message.
	pi.on("context", (event, ctx) => {
		const branch = ctx.sessionManager.getBranch();
		if (!takesFiles(ctx.model)) return markContext(event.messages, branch);
		const toolResultCarries = ctx.model.compat?.requiresAssistantAfterToolResult ? () => false : carries;
		return markContext(event.messages, branch, carries, toolResultCarries);
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (!takesFiles(ctx.model)) return undefined;
		return rewrite(event.payload, (entryId, index) => findAttachment(ctx.sessionManager.getEntry(entryId), index));
	});
}
