import { readFile, stat } from "node:fs/promises";
import { detectSupportedImageMimeTypeFromFile, type InputEvent } from "@earendil-works/pi-coding-agent";
import { fileTypeFromFile } from "file-type";
import { findPathCandidates } from "./find-paths.ts";
import type { Attachment } from "./media-entry.ts";
import { resolveExistingPath } from "./resolve-path.ts";

type ImageContent = NonNullable<InputEvent["images"]>[number];

// ponytail: files above this are left as plain paths — base64 in memory would risk an OOM.
// Raise it, or upload and send a URL instead, if large video matters.
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

async function isAttachable(path: string) {
	try {
		const stats = await stat(path);
		return stats.isFile() && stats.size > 0 && stats.size <= MAX_ATTACHMENT_BYTES;
	} catch {
		return false;
	}
}

function isMediaType(mimeType: string) {
	return mimeType.startsWith("audio/") || mimeType.startsWith("video/") || mimeType === "application/pdf";
}

// Images go to pi's own image handling, so pi's detector decides what an image is.
async function read(path: string): Promise<ImageContent | Attachment | undefined> {
	try {
		const imageType = await detectSupportedImageMimeTypeFromFile(path);
		if (imageType) return { type: "image", data: (await readFile(path)).toString("base64"), mimeType: imageType };
		const mimeType = (await fileTypeFromFile(path))?.mime;
		if (!mimeType || !isMediaType(mimeType)) return undefined;
		return { path, mimeType, data: (await readFile(path)).toString("base64") };
	} catch {
		return undefined;
	}
}

async function attach(mention: string, cwd: string) {
	const path = await resolveExistingPath(mention, cwd);
	if (!path || !(await isAttachable(path))) return undefined;
	return read(path);
}

export async function findLocalMedia(text: string, cwd: string) {
	let attachedEnd = 0;
	const images: ImageContent[] = [];
	const attachments: Attachment[] = [];
	for (const { start, end, path } of findPathCandidates(text)) {
		if (start < attachedEnd) continue;
		const found = await attach(path, cwd);
		if (!found) continue;
		attachedEnd = end;
		if ("type" in found) images.push(found);
		else attachments.push(found);
	}
	return { images, attachments };
}
