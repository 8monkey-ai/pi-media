import type { Attachment } from "../media-entry.ts";

export type FindAttachment = (entryId: string, index: number) => Attachment | undefined;

// Formats attachments for the payload of one provider API.
export interface Adapter {
	api: string;
	// When set, the adapter applies only to this provider and takes priority over an adapter for the API alone.
	provider?: string;
	carries(mimeType: string): boolean;
	// Returns undefined when the payload does not change.
	rewrite(payload: unknown, attachment: FindAttachment): unknown | undefined;
}
