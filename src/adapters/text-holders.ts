import { isRecord } from "../is-record.ts";
import { takeMarkers } from "../marker.ts";
import type { Attachment } from "../media-entry.ts";
import type { FindAttachment } from "./adapter.ts";
import type { Build } from "./part-for.ts";

// An item of the payload that keeps text with markers: a message, a tool result or a content block.
export type Holder = Record<string, unknown>;
type SplitText = (text: string, joined: boolean) => unknown[] | undefined;

// Where a holder keeps its text.
export type TextShape = {
	content: string;
	textOf(node: unknown): string | undefined;
	textNode(text: string): unknown;
	// Whether the text of a node is text blocks that pi-ai joined with "\n". A string content always is.
	joinsText?: boolean;
	// Puts the prompt cache marker of the content before the rewrite on the content after it.
	keepCacheMarker?(before: unknown, after: unknown[]): unknown[];
};

// Where a payload keeps a list of items, and which items of the list are holders.
export type HolderList = TextShape & {
	list: string;
	selects(item: Holder): boolean;
};

// Text in `content`, as a string or as `{ type: "text", text }` nodes.
export const textBlocks: TextShape = {
	content: "content",
	textOf: (node) => (isRecord(node) && node.type === "text" && typeof node.text === "string" ? node.text : undefined),
	textNode: (text) => ({ type: "text", text }),
};

function rewriteContent(content: unknown, shape: TextShape, split: SplitText) {
	if (typeof content === "string") return split(content, true);
	if (!Array.isArray(content)) return undefined;
	const replaced = content.map((node) => {
		const text = shape.textOf(node);
		return text === undefined ? undefined : split(text, shape.joinsText ?? false);
	});
	if (replaced.every((nodes) => nodes === undefined)) return undefined;
	return content.flatMap((node, index) => replaced[index] ?? [node]);
}

// Returns the parts that `build` builds for the attachments of the markers. A marker gives no part when its attachment
// is missing or `build` returns undefined, because the API cannot carry it.
export function buildParts<Part>(
	markers: { entryId: string; index: number }[],
	attachment: FindAttachment,
	build: (attachment: Attachment) => Part | undefined,
) {
	return markers.flatMap(({ entryId, index }): Part[] => {
		const found = attachment(entryId, index);
		const built = found && build(found);
		return built === undefined ? [] : [built];
	});
}

// Replaces the markers in the text of the holder with the parts that `build` builds, and removes the markers that
// give no part. Returns undefined when the holder has no marker.
export function rewriteHolder(holder: Holder, shape: TextShape, attachment: FindAttachment, build: Build): Holder | undefined {
	const split: SplitText = (text, joined) => {
		const taken = takeMarkers(text, joined);
		if (!taken) return undefined;
		const parts = buildParts(taken.markers, attachment, build);
		return taken.text ? [shape.textNode(taken.text), ...parts] : parts;
	};
	const before = holder[shape.content];
	const content = rewriteContent(before, shape, split);
	if (!content) return undefined;
	return { ...holder, [shape.content]: shape.keepCacheMarker?.(before, content) ?? content };
}

// Rewrites the holders of the list in the payload. Markers in other items stay. Items without a marker keep their
// identity. Returns undefined when no holder has a marker.
export function rewriteHolders(payload: unknown, shape: HolderList, attachment: FindAttachment, build: Build) {
	if (!isRecord(payload)) return undefined;
	const items = payload[shape.list];
	if (!Array.isArray(items)) return undefined;
	const rewritten = items.map((item) =>
		isRecord(item) && shape.selects(item) ? rewriteHolder(item, shape, attachment, build) : undefined,
	);
	if (rewritten.every((item) => item === undefined)) return undefined;
	return { ...payload, [shape.list]: items.map((item, index) => rewritten[index] ?? item) };
}
