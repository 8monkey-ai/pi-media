import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { markContext } from "./context.ts";
import { findLocalMedia } from "./media.ts";
import { ENTRY_TYPE, findAttachment, type MediaEntryData } from "./media-entry.ts";
import { rewritePayload } from "./rewrite.ts";

export default function (pi: ExtensionAPI) {
	pi.on("input", async (event, ctx) => {
		const { images, attachments } = await findLocalMedia(event.text, ctx.cwd);
		if (attachments.length > 0) pi.appendEntry(ENTRY_TYPE, { text: event.text, attachments } satisfies MediaEntryData);
		if (images.length === 0) return { action: "continue" };
		return { action: "transform", text: event.text, images: [...(event.images ?? []), ...images] };
	});

	pi.on("context", (event, ctx) => markContext(event.messages, ctx.sessionManager.getBranch()));

	pi.on("before_provider_request", (event, ctx) =>
		rewritePayload(event.payload, (entryId, index) => findAttachment(ctx.sessionManager.getEntry(entryId), index)),
	);
}
