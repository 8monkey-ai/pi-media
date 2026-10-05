import type { ContextEvent, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Adapter } from "./adapters/adapter.ts";
import { makeMarker } from "./marker.ts";
import { mediaForContext } from "./media-entry.ts";

// Adds one marker block per attachment that the adapter carries to each linked user message, for this request only.
export function markContext(messages: ContextEvent["messages"], branch: SessionEntry[], adapter: Pick<Adapter, "carries">) {
	const markers = mediaForContext(messages, branch).map((entries) =>
		entries.flatMap((entry) =>
			(entry.data?.attachments ?? []).flatMap((attachment, index) =>
				adapter.carries(attachment.mimeType) ? [{ type: "text" as const, text: makeMarker(entry.id, index) }] : [],
			),
		),
	);
	if (markers.every((blocks) => blocks.length === 0)) return undefined;
	return {
		messages: messages.map((message, position) => {
			if (message.role !== "user" || markers[position].length === 0) return message;
			const content = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
			return { ...message, content: [...content, ...markers[position]] };
		}),
	};
}
