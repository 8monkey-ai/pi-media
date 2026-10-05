import type { ContextEvent, CustomEntry, SessionEntry } from "@earendil-works/pi-coding-agent";

export const ENTRY_TYPE = "pi-media";

export type Attachment = { path: string; mimeType: string; data: string };
export type MediaEntryData = { text: string; attachments: Attachment[] };

type MediaEntry = CustomEntry<MediaEntryData>;

function isMediaEntry(entry: SessionEntry | undefined): entry is MediaEntry {
	return (
		entry?.type === "custom" && entry.customType === ENTRY_TYPE && typeof (entry.data as { text?: unknown })?.text === "string"
	);
}

function isAttachment(value: unknown): value is Attachment {
	const { path, mimeType, data } = (value ?? {}) as Record<string, unknown>;
	return typeof path === "string" && typeof mimeType === "string" && typeof data === "string";
}

// pi-media's read tool keeps the attachment of a media file in the `details` of its tool result.
export function toolResultAttachment(message: ContextEvent["messages"][number]) {
	return message.role === "toolResult" && message.toolName === "read" && isAttachment(message.details)
		? message.details
		: undefined;
}

// A marker names a pi-media entry and the index of its attachment, or a tool result entry and index 0.
export function findAttachment(entry: SessionEntry | undefined, index: number): Attachment | undefined {
	if (entry?.type === "message") return index === 0 ? toolResultAttachment(entry.message) : undefined;
	if (!isMediaEntry(entry) || !Array.isArray(entry.data?.attachments)) return undefined;
	return entry.data.attachments[index];
}

function firstText(content: unknown) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return undefined;
	return content.find((part) => part?.type === "text" && typeof part.text === "string")?.text as string | undefined;
}

// Pi adds image hints after a blank line when it resizes or converts an image in the same message.
// An entry with the exact text comes first, because the text of an entry can itself hold a blank line.
function findEntryFor(pending: MediaEntry[], text: string) {
	const exact = pending.findLastIndex((entry) => entry.data?.text === text);
	return exact !== -1 ? exact : pending.findLastIndex((entry) => text.startsWith(`${entry.data?.text}\n\n`));
}

// Each user message on the branch takes the newest earlier pi-media entry with its text that no other message took.
// Queued steer and follow-up messages reach the session later than their entry, so position alone cannot link them.
// A message takes one entry at most: an entry that no message took, for example after a cleared queue or a tree edit,
// must not give the model the same file two times when the same text is sent again with a new entry.
// Returns every user message on the branch, in order, with its linked entries.
function linkUserMessages(branch: SessionEntry[]) {
	const pending: MediaEntry[] = [];
	const users: { timestamp: number; entries: MediaEntry[] }[] = [];
	for (const entry of branch) {
		if (isMediaEntry(entry)) {
			pending.push(entry);
			continue;
		}
		if (entry.type !== "message" || entry.message.role !== "user") continue;
		const text = firstText(entry.message.content);
		const index = text === undefined ? -1 : findEntryFor(pending, text);
		users.push({ timestamp: entry.message.timestamp, entries: index === -1 ? [] : pending.splice(index, 1) });
	}
	return users;
}

// Context messages have no entry ids. User messages keep the branch order and the timestamp of their entry,
// and queued messages can share one timestamp, so the match walks both lists in order.
export function mediaForContext(messages: ContextEvent["messages"], branch: SessionEntry[]) {
	const users = linkUserMessages(branch);
	let next = 0;
	return messages.map((message) => {
		if (message.role !== "user") return [];
		const index = users.findIndex((user, position) => position >= next && user.timestamp === message.timestamp);
		if (index === -1) return [];
		next = index + 1;
		return users[index].entries;
	});
}
