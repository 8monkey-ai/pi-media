import { createReadToolDefinition, type ReadToolDetails, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { findMediaFile, readAttachment } from "./media.ts";
import type { Attachment } from "./media-entry.ts";

type PiReadTool = ReturnType<typeof createReadToolDefinition>;
// Pi's renderers read only `truncation` from the details, so they also take the details of a media file.
type ReadDetails = (ReadToolDetails & Partial<Attachment>) | undefined;

function kindName(mimeType: string) {
	return mimeType === "application/pdf" ? "PDF" : mimeType.slice(0, mimeType.indexOf("/"));
}

// The bytes of an audio, video or PDF file go in `details`, which pi stores in the session as JSON,
// so the bytes follow the branch.
// `autoResizeImages` is a function so that a changed pi setting applies on the next read.
export function createMediaReadTool(
	autoResizeImages: () => boolean | undefined,
	maxBytes: number,
): ToolDefinition<PiReadTool["parameters"], ReadDetails> {
	// Only the name, schema, prompt text and renderers come from this definition. `execute` uses the cwd of the session.
	const piRead = createReadToolDefinition(process.cwd());
	return {
		...piRead,
		description: `${piRead.description} Also reads audio, video and PDF files.`,
		async execute(...args) {
			const [, { path }, , , ctx] = args;
			const file = await findMediaFile(path, ctx.cwd);
			if (!file || file.image) {
				return createReadToolDefinition(ctx.cwd, { autoResizeImages: autoResizeImages() }).execute(...args);
			}
			const kind = `${kindName(file.mimeType)} file [${file.mimeType}]`;
			// Pi's read tool would return the bytes of a large media file as text, so the model gets only this note.
			if (file.size > maxBytes) {
				const text = `${kind} is larger than the pi-media limit maxAttachmentBytes (${maxBytes} bytes): ${file.path}`;
				return { content: [{ type: "text", text }], details: undefined };
			}
			return {
				content: [{ type: "text", text: `Read ${kind}: ${file.path}` }],
				details: await readAttachment(file.path, file.mimeType),
			};
		},
	};
}
