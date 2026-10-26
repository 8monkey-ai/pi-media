import { createReadToolDefinition, type ReadToolDetails, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Settings } from "./config.ts";
import { findMediaFile, readAttachment } from "./media.ts";
import type { Attachment } from "./media-entry.ts";
import { mediaModelFor, modelName, readWithMediaModel } from "./media-model.ts";

type PiReadTool = ReturnType<typeof createReadToolDefinition>;
// Pi's renderers read only `truncation` from the details, so they also take the details of a media file.
type ReadDetails = (ReadToolDetails & Partial<Attachment> & { model?: string }) | undefined;

function kindName(mimeType: string) {
	return mimeType === "application/pdf" ? "PDF" : mimeType.slice(0, mimeType.indexOf("/"));
}

// The bytes of an audio, video or PDF file without a media model go in `details`, which pi stores in the session as
// JSON, so the bytes follow the branch.
// `autoResizeImages` is a function, and `/media-models` changes `settings` in place, so a changed setting applies on the next read.
// While `readsMedia` gives false, the tool reads every file as pi's read tool does.
export function createMediaReadTool(
	autoResizeImages: () => boolean | undefined,
	settings: Settings,
	readsMedia: () => boolean,
): ToolDefinition<PiReadTool["parameters"], ReadDetails> {
	// Only the name, schema, prompt text and renderers come from this definition. `execute` uses the cwd of the session.
	const piRead = createReadToolDefinition(process.cwd());
	return {
		...piRead,
		description: `${piRead.description} Also reads audio, video and PDF files.`,
		async execute(...args) {
			const [, { path }, signal, , ctx] = args;
			const file = readsMedia() ? await findMediaFile(path, ctx.cwd) : undefined;
			const model = file && mediaModelFor(settings, file.mimeType);
			if (!file || (file.image && !model)) {
				return createReadToolDefinition(ctx.cwd, { autoResizeImages: autoResizeImages() }).execute(...args);
			}
			const kind = `${kindName(file.mimeType)} file [${file.mimeType}]`;
			const maxBytes = settings.maxAttachmentBytes;
			// Above the cap, a media file goes neither to pi's read tool, which returns its bytes as text, nor to a media model.
			if (file.size > maxBytes) {
				const text = `${kind} is larger than the pi-media limit maxAttachmentBytes (${maxBytes} bytes): ${file.path}`;
				return { content: [{ type: "text", text }], details: undefined };
			}
			const attachment = await readAttachment(file.path, file.mimeType);
			if (!model) return { content: [{ type: "text", text: `Read ${kind}: ${file.path}` }], details: attachment };
			// Without a signal from pi, the call cannot be stopped.
			const { text } = await readWithMediaModel(attachment, model, ctx.modelRegistry, signal ?? new AbortController().signal);
			return { content: [{ type: "text", text }], details: { model: modelName(model), path: file.path } };
		},
	};
}
