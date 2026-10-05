import type { ContextEvent, SessionEntry } from "@earendil-works/pi-coding-agent";
import { makeMarker } from "./marker.ts";
import { mediaForContext } from "./media-entry.ts";

// Adds one marker block per attachment to each linked user message, for this request only.
export function markContext(messages: ContextEvent["messages"], branch: SessionEntry[]) {
	const media = mediaForContext(messages, branch);
	if (media.every((entries) => entries.length === 0)) return undefined;
	return {
		messages: messages.map((message, position) => {
			if (message.role !== "user" || media[position].length === 0) return message;
			const markers = media[position].flatMap((entry) =>
				(entry.data?.attachments ?? []).map((_, index) => ({ type: "text" as const, text: makeMarker(entry.id, index) })),
			);
			const content = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
			return { ...message, content: [...content, ...markers] };
		}),
	};
}
