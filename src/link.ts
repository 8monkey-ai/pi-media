import type { ContextEvent, SessionEntry } from "@earendil-works/pi-coding-agent";
import { isMediaEntry, type MediaEntry } from "./media-entry.ts";

type Messages = ContextEvent["messages"];
type UserContent = Extract<Messages[number], { role: "user" }>["content"];

function firstText(content: UserContent) {
	if (typeof content === "string") return content;
	for (const part of content) if (part.type === "text") return part.text;
	return undefined;
}

// Pi adds image hints after a blank line when it resizes or converts an image in the same message.
// An entry with the exact text comes first, because the text of an entry can itself hold a blank line.
function findEntryFor(pending: MediaEntry[], text: string) {
	const exact = pending.findLastIndex((entry) => entry.data.text === text);
	return exact !== -1 ? exact : pending.findLastIndex((entry) => text.startsWith(`${entry.data.text}\n\n`));
}

// Each user message on the branch takes the newest earlier pi-media entry with its text that no other message took.
// Queued steer and follow-up messages reach the session later than their entry, so position alone cannot link them.
// A message takes one entry at most: an entry that no message took, for example after a cleared queue or a tree edit,
// must not give the model the same file two times when the same text is sent again with a new entry.
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
export function mediaForContext(messages: Messages, branch: SessionEntry[]) {
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
