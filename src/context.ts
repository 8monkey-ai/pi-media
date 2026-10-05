import type { ContextEvent, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Adapter } from "./adapters/adapter.ts";
import { mediaForContext } from "./link.ts";
import { makeMarker } from "./marker.ts";
import { toolResultAttachment } from "./media-entry.ts";

type Messages = ContextEvent["messages"];
type Carries = Adapter["carries"];

const NOT_IN_REQUEST = "[The API of the current model cannot take this file type. The file content is not in this request.]";

function textBlock(text: string) {
	return { type: "text" as const, text };
}

function markUserMessages(messages: Messages, branch: SessionEntry[], carries: Carries): Messages {
	const markers = mediaForContext(messages, branch).map((entries) =>
		entries.flatMap((entry) =>
			entry.data.attachments.flatMap((attachment, index) =>
				carries(attachment.mimeType, "user") ? [textBlock(makeMarker(entry.id, index))] : [],
			),
		),
	);
	return messages.map((message, position) => {
		if (message.role !== "user" || markers[position].length === 0) return message;
		const content = typeof message.content === "string" ? [textBlock(message.content)] : message.content;
		return { ...message, content: [...content, ...markers[position]] };
	});
}

// Context messages have no entry ids, and some servers give the same tool call id to more than one call,
// so the match walks the tool results of both lists in order.
function toolResultEntryIds(messages: Messages, branch: SessionEntry[]) {
	const entries = branch.flatMap((entry) =>
		entry.type === "message" && entry.message.role === "toolResult" ? [{ id: entry.id, message: entry.message }] : [],
	);
	let next = 0;
	return messages.map((message) => {
		if (message.role !== "toolResult") return undefined;
		const index = entries.findIndex(
			(entry, position) =>
				position >= next && entry.message.timestamp === message.timestamp && entry.message.toolCallId === message.toolCallId,
		);
		if (index === -1) return undefined;
		next = index + 1;
		return entries[index].id;
	});
}

// Adds a marker block to each tool result whose attachment the adapter carries, and a note to the other tool results
// with an attachment, so the model knows that it did not get the file.
function markToolResults(messages: Messages, branch: SessionEntry[], carries: Carries): Messages {
	const entryIds = toolResultEntryIds(messages, branch);
	return messages.map((message, position) => {
		if (message.role !== "toolResult") return message;
		const attachment = toolResultAttachment(message);
		if (!attachment) return message;
		const entryId = entryIds[position];
		const placed = entryId !== undefined && carries(attachment.mimeType, "toolResult");
		return { ...message, content: [...message.content, textBlock(placed ? makeMarker(entryId, 0) : NOT_IN_REQUEST)] };
	});
}

// Changes the messages of this request only. Returns undefined when no message changes.
export function markContext(messages: Messages, branch: SessionEntry[], adapter: Pick<Adapter, "carries"> | undefined) {
	const carries: Carries = (mimeType, place) => adapter?.carries(mimeType, place) ?? false;
	const marked = markToolResults(markUserMessages(messages, branch, carries), branch, carries);
	return marked.some((message, index) => message !== messages[index]) ? { messages: marked } : undefined;
}
