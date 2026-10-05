import { splitMarkers } from "../marker.ts";
import type { Attachment } from "../media-entry.ts";
import type { FindAttachment } from "./adapter.ts";

type Message = Record<string, unknown>;
type SplitText = (text: string) => unknown[] | undefined;

// Where one API keeps user messages and their text in the payload.
export type PayloadShape = {
	messages: string;
	isUser(message: Message): boolean;
	content: string;
	textOf(node: unknown): string | undefined;
	textNode(text: string): unknown;
};

function rewriteContent(content: unknown, textOf: PayloadShape["textOf"], split: SplitText) {
	if (typeof content === "string") return split(content);
	if (!Array.isArray(content)) return undefined;
	const replaced = content.map((node) => {
		const text = textOf(node);
		return text === undefined ? undefined : split(text);
	});
	if (replaced.every((nodes) => nodes === undefined)) return undefined;
	return content.flatMap((node, index) => replaced[index] ?? [node]);
}

function isMessage(value: unknown): value is Message {
	return !!value && typeof value === "object";
}

// Replaces markers in the text of user messages with the parts that `part` builds.
// A marker is removed when its attachment is missing or `part` returns undefined, because the API cannot carry it.
// Markers in other messages stay. Messages without a marker keep their identity.
export function rewriteUserMessages(
	payload: unknown,
	shape: PayloadShape,
	attachment: FindAttachment,
	part: (attachment: Attachment) => unknown,
) {
	if (!isMessage(payload)) return undefined;
	const messages = payload[shape.messages];
	if (!Array.isArray(messages)) return undefined;
	const split: SplitText = (text) => {
		const segments = splitMarkers(text);
		if (!segments.some((segment) => segment.type === "media")) return undefined;
		return segments.flatMap((segment) => {
			if (segment.type === "text") return [shape.textNode(segment.text)];
			const found = attachment(segment.entryId, segment.index);
			const built = found && part(found);
			return built === undefined ? [] : [built];
		});
	};
	const contents = messages.map((message) =>
		isMessage(message) && shape.isUser(message) ? rewriteContent(message[shape.content], shape.textOf, split) : undefined,
	);
	if (contents.every((content) => content === undefined)) return undefined;
	return {
		...payload,
		[shape.messages]: messages.map((message, index) =>
			contents[index] ? { ...message, [shape.content]: contents[index] } : message,
		),
	};
}
