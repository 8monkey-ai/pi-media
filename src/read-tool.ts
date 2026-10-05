import { createReadToolDefinition, type ReadToolDetails, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { findMediaFile, readAttachment } from "./media.ts";
import type { Attachment } from "./media-entry.ts";

type PiReadTool = ReturnType<typeof createReadToolDefinition>;
// Pi's renderers read only `truncation` from the details, so they also take the details of a media file.
type ReadDetails = (ReadToolDetails & Partial<Attachment>) | undefined;

function kindName(mimeType: string) {
	return mimeType === "application/pdf" ? "PDF" : mimeType.slice(0, mimeType.indexOf("/"));
}

// Pi's read tool, which also returns audio, video and PDF files. It keeps their bytes in `details`, which pi stores
// in the session as JSON, so the bytes follow the branch. All other files, images too, go to pi's read tool.
// `autoResizeImages` runs on each read, so a changed setting applies to the next read.
export function createMediaReadTool(
	autoResizeImages: () => boolean | undefined,
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
			return {
				content: [{ type: "text", text: `Read ${kindName(file.mimeType)} file [${file.mimeType}]: ${file.path}` }],
				details: await readAttachment(file.path, file.mimeType),
			};
		},
	};
}
