import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import "./adapters/index.ts";
import { findAdapter } from "./adapters/registry.ts";
import { readMaxAttachmentBytes } from "./config.ts";
import { markContext } from "./context.ts";
import { findLocalMedia } from "./media.ts";
import { ENTRY_TYPE, findAttachment, type MediaEntryData } from "./media-entry.ts";
import { createMediaReadTool } from "./read-tool.ts";

export default function (pi: ExtensionAPI) {
	const maxAttachmentBytes = readMaxAttachmentBytes();
	pi.registerTool(createMediaReadTool(() => pi.getSettings().images?.autoResize, maxAttachmentBytes));

	pi.on("input", async (event, ctx) => {
		const { images, attachments } = await findLocalMedia(event.text, ctx.cwd, maxAttachmentBytes);
		if (attachments.length > 0) pi.appendEntry(ENTRY_TYPE, { text: event.text, attachments } satisfies MediaEntryData);
		if (images.length === 0) return { action: "continue" };
		return { action: "transform", text: event.text, images: [...(event.images ?? []), ...images] };
	});

	pi.on("context", (event, ctx) => markContext(event.messages, ctx.sessionManager.getBranch(), findAdapter(ctx.model)));

	pi.on("before_provider_request", (event, ctx) =>
		findAdapter(ctx.model)?.rewrite(event.payload, (entryId, index) =>
			findAttachment(ctx.sessionManager.getEntry(entryId), index),
		),
	);
}
