import { takeMarkers } from "../marker.ts";
import type { FindAttachment } from "./adapter.ts";
import { type Build, builderIn, carriesBy } from "./part-for.ts";
import { registerAdapter } from "./registry.ts";
import { type HolderList, isRecord, rewriteHolders } from "./text-holders.ts";

type Content = { role?: unknown; parts?: unknown };
type FunctionResponse = { response?: Record<string, unknown>; parts?: unknown[] };
type File = { mimeType: string; part: unknown };

// Gemini and Vertex AI share one request format: pi-ai builds both with the same converter.
const userContents: HolderList = {
	list: "contents",
	selects: (content) => content.role === "user",
	content: "parts",
	textOf: (part) => (isRecord(part) && typeof part.text === "string" ? part.text : undefined),
	textNode: (text) => ({ text }),
};

const inlineData: Build = ({ data, mimeType }) => ({ inlineData: { mimeType, data } });

// Gemini takes audio, video and PDFs as inlineData parts, in user turns and for tool results.
function partFor(mimeType: string) {
	return mimeType.startsWith("audio/") || mimeType.startsWith("video/") || mimeType === "application/pdf"
		? inlineData
		: undefined;
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
function fitsFunctionResponse(file: File) {
	return file.mimeType === "application/pdf";
}

const toolResultPart = builderIn(partFor, "toolResult");

// pi-ai joins the text blocks of a tool result with "\n". Returns the text without its markers, and the parts of the
// carried attachments of these markers.
function takeMarkerLines(text: string, attachment: FindAttachment) {
	const taken = takeMarkers(text, true);
	if (!taken) return undefined;
	const files = taken.markers.flatMap(({ entryId, index }): File[] => {
		const found = attachment(entryId, index);
		const part = found && toolResultPart(found);
		return found && part !== undefined ? [{ mimeType: found.mimeType, part }] : [];
	});
	return { text: taken.text, files };
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
				...(nested.length > 0 && { parts: [...(functionResponse?.parts ?? []), ...nested.map((file) => file.part)] }),
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
	return role === "user" && Array.isArray(parts) && userContents.textOf(parts[0]) === "Tool result image:";
}

function fileParts(files: File[]) {
	return [{ text: "Tool result file:" }, ...files.map((file) => file.part)];
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
	const users = rewriteHolders(payload, userContents, attachment, builderIn(partFor, "user"));
	const current = users ?? payload;
	if (!isRecord(current) || !Array.isArray(current.contents)) return users;
	const contents = rewriteToolResults(current.contents, attachment, takesFunctionResponseParts(current.model));
	return contents ? { ...current, contents } : users;
}

for (const api of ["google-generative-ai", "google-vertex"]) {
	registerAdapter({ api, carries: carriesBy(partFor), rewrite });
}
