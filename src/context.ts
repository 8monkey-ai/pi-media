import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { mediaForContext } from "./link.ts";
import { makeMarker } from "./marker.ts";
import { matchInOrder } from "./match-in-order.ts";
import { type Messages, toolResultAttachment } from "./media-entry.ts";

type Carries = (mimeType: string) => boolean;

const NOT_IN_REQUEST = "[The API of the current model cannot take this file type. The file content is not in this request.]";

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

// Context messages have no entry ids, and some servers give the same tool call id to more than one call,
// so the match walks the tool results of both lists in order.
function toolResultEntryIds(messages: Messages, branch: SessionEntry[]) {
	const entries = branch.flatMap((entry) =>
		entry.type === "message" && entry.message.role === "toolResult" ? [{ id: entry.id, message: entry.message }] : [],
	);
	return matchInOrder(
		messages,
		entries,
		(message, entry) =>
			message.role === "toolResult" &&
			message.timestamp === entry.message.timestamp &&
			message.toolCallId === entry.message.toolCallId,
	).map((entry) => entry?.id);
}

// Adds a marker block to each tool result whose attachment the request carries, and a note to the other tool results
// with an attachment, so the model knows that it did not get the file.
function markToolResults(messages: Messages, branch: SessionEntry[], carries: Carries): Messages {
	const entryIds = toolResultEntryIds(messages, branch);
	return messages.map((message, position) => {
		if (message.role !== "toolResult") return message;
		const attachment = toolResultAttachment(message);
		if (!attachment) return message;
		const entryId = entryIds[position];
		const placed = entryId !== undefined && carries(attachment.mimeType);
		return { ...message, content: [...message.content, textBlock(placed ? makeMarker(entryId, 0) : NOT_IN_REQUEST)] };
	});
}

// Changes the messages of this request only. Without `carries`, the request carries no file. Returns undefined when no
// message changes.
export function markContext(messages: Messages, branch: SessionEntry[], carries: Carries = () => false) {
	const marked = markToolResults(markUserMessages(messages, branch, carries), branch, carries);
	return marked.some((message, index) => message !== messages[index]) ? { messages: marked } : undefined;
}
