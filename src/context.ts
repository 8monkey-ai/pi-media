import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { mediaForContext } from "./link.ts";
import { makeMarker } from "./marker.ts";
import type { Messages } from "./media-entry.ts";

type Carries = (mimeType: string) => boolean;

function textBlock(text: string) {
	return { type: "text" as const, text };
}

function markUserMessages(messages: Messages, branch: SessionEntry[], carries: Carries): Messages {
	const markers = mediaForContext(messages, branch).map((entries) =>
		entries.flatMap((entry) =>
			entry.data.attachments.flatMap((attachment, index) =>
				carries(attachment.mimeType) ? [textBlock(makeMarker(entry.id, index))] : [],
			),
		),
	);
	return messages.map((message, position) => {
		if (message.role !== "user" || markers[position].length === 0) return message;
		const content = typeof message.content === "string" ? [textBlock(message.content)] : message.content;
		return { ...message, content: [...content, ...markers[position]] };
	});
}

// Changes the messages of this request only. Without `carries`, the request carries no file. Returns undefined when no
// message changes.
export function markContext(messages: Messages, branch: SessionEntry[], carries: Carries = () => false) {
	const marked = markUserMessages(messages, branch, carries);
	return marked.some((message, index) => message !== messages[index]) ? { messages: marked } : undefined;
}
