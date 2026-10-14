import type { ContextEvent, CustomEntry, SessionEntry } from "@earendil-works/pi-coding-agent";
import { isRecord } from "./is-record.ts";

export const ENTRY_TYPE = "pi-media";

export type Attachment = { path: string; mimeType: string; data: string };
export type MediaEntryData = { text: string; attachments: Attachment[] };

export type MediaEntry = CustomEntry & { data: MediaEntryData };
export type Messages = ContextEvent["messages"];

function isAttachment(value: unknown): value is Attachment {
	return (
		isRecord(value) && typeof value.path === "string" && typeof value.mimeType === "string" && typeof value.data === "string"
	);
}

export function isMediaEntry(entry: SessionEntry | undefined): entry is MediaEntry {
	if (entry?.type !== "custom" || entry.customType !== ENTRY_TYPE) return false;
	const { data } = entry;
	return (
		isRecord(data) && typeof data.text === "string" && Array.isArray(data.attachments) && data.attachments.every(isAttachment)
	);
}

// A marker names a pi-media entry and the index of its attachment.
export function findAttachment(entry: SessionEntry | undefined, index: number): Attachment | undefined {
	return isMediaEntry(entry) ? entry.data.attachments[index] : undefined;
}
