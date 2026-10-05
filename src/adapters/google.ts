import { splitMarkers } from "../marker.ts";
import type { Attachment } from "../media-entry.ts";
import type { FindAttachment } from "./adapter.ts";
import { registerAdapter } from "./registry.ts";
import { type PayloadShape, rewriteUserMessages } from "./user-messages.ts";

type Content = { role?: unknown; parts?: unknown };
type FunctionResponse = { response?: Record<string, unknown>; parts?: unknown[] };

// Gemini and Vertex AI share one request format: pi-ai builds both with the same converter.
const shape: PayloadShape = {
	messages: "contents",
	isUser: (content) => content.role === "user",
	content: "parts",
	textOf: (part) => {
		const { text } = (part ?? {}) as { text?: unknown };
		return typeof text === "string" ? text : undefined;
	},
	textNode: (text) => ({ text }),
};

function carries(mimeType: string) {
	return mimeType.startsWith("audio/") || mimeType.startsWith("video/") || mimeType === "application/pdf";
}

function inlineData({ data, mimeType }: Attachment) {
	return { inlineData: { mimeType, data } };
}

// The same rule as pi-ai's `supportsMultimodalFunctionResponse`: Gemini 3 and later, and models that are not Gemini,
// take media in `functionResponse.parts`. pi-ai does not export it.
function takesFunctionResponseParts(modelId: unknown) {
	const match = String(modelId)
		.toLowerCase()
		.match(/^gemini(?:-live)?-(\d+)/);
	return !match || Number(match[1]) >= 3;
}

// Vertex AI accepts images, PDF and plain text in `functionResponse.parts`. Audio and video go in a user turn.
function fitsFunctionResponse(attachment: Attachment) {
	return attachment.mimeType === "application/pdf";
}

// The context hook adds a tool result marker as a text block of its own, and pi-ai joins text blocks with "\n".
// Removes each line that is only a marker, and returns the carried attachments of these markers.
function takeMarkerLines(text: string, attachment: FindAttachment) {
	const lines = text.split("\n");
	const files: Attachment[] = [];
	const kept = lines.filter((line) => {
		const [segment, ...rest] = splitMarkers(line);
		if (segment?.type !== "media" || rest.length > 0) return true;
		const found = attachment(segment.entryId, segment.index);
		if (found && carries(found.mimeType)) files.push(found);
		return false;
	});
	return kept.length === lines.length ? undefined : { text: kept.join("\n"), files };
}

// Returns the function response part without its markers, and the files that must go in a user turn after it.
function rewriteFunctionResponse(part: unknown, attachment: FindAttachment, takesParts: boolean) {
	const { functionResponse } = (part ?? {}) as { functionResponse?: FunctionResponse };
	const response = functionResponse?.response ?? {};
	const key = typeof response.output === "string" ? "output" : "error";
	const text = response[key];
	const taken = typeof text === "string" ? takeMarkerLines(text, attachment) : undefined;
	if (!taken) return undefined;
	const nested = takesParts ? taken.files.filter(fitsFunctionResponse) : [];
	return {
		part: {
			...(part as object),
			functionResponse: {
				...functionResponse,
				response: { ...response, [key]: taken.text },
				...(nested.length > 0 && { parts: [...(functionResponse?.parts ?? []), ...nested.map(inlineData)] }),
			},
		},
		files: taken.files.filter((file) => !nested.includes(file)),
	};
}

function rewriteFunctionResponseTurn(content: unknown, attachment: FindAttachment, takesParts: boolean) {
	const { role, parts } = (content ?? {}) as Content;
	if (role !== "user" || !Array.isArray(parts)) return undefined;
	const rewritten = parts.map((part) => rewriteFunctionResponse(part, attachment, takesParts));
	if (rewritten.every((result) => result === undefined)) return undefined;
	return {
		content: { ...(content as object), parts: parts.map((part, index) => rewritten[index]?.part ?? part) },
		files: rewritten.flatMap((result) => result?.files ?? []),
	};
}

// pi-ai adds tool result images to older models in a user turn right after the function responses.
function isToolResultImageTurn(content: unknown) {
	const { role, parts } = (content ?? {}) as Content;
	return role === "user" && Array.isArray(parts) && shape.textOf(parts[0]) === "Tool result image:";
}

function fileParts(files: Attachment[]) {
	return [{ text: "Tool result file:" }, ...files.map(inlineData)];
}

function rewriteToolResults(contents: unknown[], attachment: FindAttachment, takesParts: boolean) {
	const turns = contents.map((content) => rewriteFunctionResponseTurn(content, attachment, takesParts));
	if (turns.every((turn) => turn === undefined)) return undefined;
	return contents.flatMap((content, index) => {
		const before = turns[index - 1]?.files ?? [];
		if (before.length > 0 && isToolResultImageTurn(content)) {
			return [{ ...(content as object), parts: [...(content as { parts: unknown[] }).parts, ...fileParts(before)] }];
		}
		const turn = turns[index];
		if (!turn) return [content];
		if (turn.files.length === 0 || isToolResultImageTurn(contents[index + 1])) return [turn.content];
		return [turn.content, { role: "user", parts: fileParts(turn.files) }];
	});
}

function rewrite(payload: unknown, attachment: FindAttachment) {
	const users = rewriteUserMessages(payload, shape, attachment, (file) =>
		carries(file.mimeType) ? inlineData(file) : undefined,
	);
	const { contents, model } = (users ?? payload ?? {}) as { contents?: unknown; model?: unknown };
	const rewritten = Array.isArray(contents) && rewriteToolResults(contents, attachment, takesFunctionResponseParts(model));
	return rewritten ? { ...(users ?? (payload as object)), contents: rewritten } : users;
}

for (const api of ["google-generative-ai", "google-vertex"]) {
	registerAdapter({ api, carries, rewrite });
}
