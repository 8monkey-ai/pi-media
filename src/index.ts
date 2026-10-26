import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { rewrite } from "./chat-completions.ts";
import { readSettings } from "./config.ts";
import { markContext } from "./context.ts";
import { carries } from "./file-parts.ts";
import { findLocalMedia } from "./media.ts";
import { ENTRY_TYPE, findAttachment, type MediaEntryData } from "./media-entry.ts";
import { readWithMediaModels } from "./media-model.ts";
import { mediaModelsCommand } from "./media-models-command.ts";
import { footerStatus, unknownProviderErrors } from "./media-status.ts";
import { renderMediaText, TEXT_TYPE } from "./media-text.ts";
import { createMediaReadTool } from "./read-tool.ts";

// Only the Chat Completions API gets files. Other APIs, and virtual models that hide the API that answers, get the path
// as text.
const takesFiles = (model: Model<Api> | undefined): model is Model<"openai-completions"> => model?.api === "openai-completions";

export default function (pi: ExtensionAPI) {
	const { path, settings } = readSettings();
	const { maxAttachmentBytes } = settings;
	// Pi has no model registry while extensions load, so `session_start` checks the providers.
	let enabled = true;
	pi.registerTool(
		createMediaReadTool(
			() => pi.getSettings().images?.autoResize,
			maxAttachmentBytes,
			() => enabled,
		),
	);

	const applySettings = (ctx: ExtensionContext) => {
		const errors = unknownProviderErrors(path, settings, (provider) => ctx.modelRegistry.getProvider(provider) !== undefined);
		// Without a UI, as in print mode, `notify` shows nothing.
		for (const error of errors) {
			if (ctx.hasUI) ctx.ui.notify(error, "error");
			else console.error(error);
		}
		enabled = errors.length === 0;
		ctx.ui.setStatus("pi-media", enabled ? footerStatus(settings) : undefined);
	};
	pi.on("session_start", (_event, ctx) => applySettings(ctx));
	pi.registerCommand("media-models", mediaModelsCommand(path, settings, applySettings));

	pi.registerMessageRenderer(TEXT_TYPE, renderMediaText);

	// A text goes after the user message. For a message that waits in the queue, the text goes in the same queue, before
	// the message.
	pi.on("input", async (event, ctx) => {
		if (!enabled) return { action: "continue" };
		// shortcut: pi gives the main model one queued message per turn, so a message sent while the agent works gets a turn
		// with the text alone before the user message, upgrade when pi can deliver a custom message with a queued message.
		// A `nextTurn` text stays pending when the prompt fails after this hook, and goes with the next prompt.
		const deliverAs = event.streamingBehavior ?? "nextTurn";
		// Pi puts its images before the text. Images that pi-media did not read from a path have no name, so their number
		// names them.
		const pasted = (event.images ?? []).map(({ data, mimeType }, index) => ({ path: `image ${index + 1}`, mimeType, data }));
		const found = await findLocalMedia(event.text, ctx.cwd, maxAttachmentBytes);
		const others = await readWithMediaModels([...pasted, ...found], settings, ctx, ({ text, error }) =>
			pi.sendMessage({ customType: TEXT_TYPE, content: text, display: true, details: { error } }, { deliverAs }),
		);
		const images = others.filter(({ mimeType }) => mimeType.startsWith("image/"));
		const attachments = others.filter(({ mimeType }) => !mimeType.startsWith("image/"));
		if (attachments.length > 0) {
			pi.appendEntry(ENTRY_TYPE, { text: event.text, attachments } satisfies MediaEntryData);
		}
		// All images go to the image model or none do, so the same number of images means that pi has its own images.
		if (images.length === pasted.length) return { action: "continue" };
		return {
			action: "transform",
			text: event.text,
			images: images.map(({ data, mimeType }) => ({ type: "image", data, mimeType })),
		};
	});

	// The files of tool results go in a user message after the tool messages. A model that needs an assistant message
	// after tool results gets no files from tool results, so that pi-media does not add an assistant message.
	pi.on("context", (event, ctx) => {
		const branch = ctx.sessionManager.getBranch();
		if (!enabled || !takesFiles(ctx.model)) return markContext(event.messages, branch);
		const toolResultCarries = ctx.model.compat?.requiresAssistantAfterToolResult ? () => false : carries;
		return markContext(event.messages, branch, carries, toolResultCarries);
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (!enabled || !takesFiles(ctx.model)) return undefined;
		return rewrite(event.payload, (entryId, index) => findAttachment(ctx.sessionManager.getEntry(entryId), index));
	});
}
