import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import "./adapters/index.ts";
import { findAdapter } from "./adapters/registry.ts";
import { markContext } from "./context.ts";
import { findLocalMedia } from "./media.ts";
import { ENTRY_TYPE, findAttachment, type MediaEntryData } from "./media-entry.ts";

export default function (pi: ExtensionAPI) {
	pi.on("input", async (event, ctx) => {
		const { images, attachments } = await findLocalMedia(event.text, ctx.cwd);
		if (attachments.length > 0) pi.appendEntry(ENTRY_TYPE, { text: event.text, attachments } satisfies MediaEntryData);
		if (images.length === 0) return { action: "continue" };
		return { action: "transform", text: event.text, images: [...(event.images ?? []), ...images] };
	});

	pi.on("context", (event, ctx) => {
		const adapter = findAdapter(ctx.model);
		return adapter && markContext(event.messages, ctx.sessionManager.getBranch(), adapter);
	});

	pi.on("before_provider_request", (event, ctx) =>
		findAdapter(ctx.model)?.rewrite(event.payload, (entryId, index) =>
			findAttachment(ctx.sessionManager.getEntry(entryId), index),
		),
	);
}
