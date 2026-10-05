import { readFile, stat } from "node:fs/promises";
import { detectSupportedImageMimeTypeFromFile, type InputEvent } from "@earendil-works/pi-coding-agent";
import { fileTypeFromFile } from "file-type";
import { findPathCandidates } from "./find-paths.ts";
import type { Attachment } from "./media-entry.ts";
import { resolveExistingPath } from "./resolve-path.ts";

type ImageContent = NonNullable<InputEvent["images"]>[number];

async function isAttachable(path: string, maxBytes: number) {
	try {
		const stats = await stat(path);
		return stats.isFile() && stats.size > 0 && stats.size <= maxBytes;
	} catch {
		return false;
	}
}

function isMediaType(mimeType: string) {
	return mimeType.startsWith("audio/") || mimeType.startsWith("video/") || mimeType === "application/pdf";
}

// Images go to pi's own image handling, so pi's detector decides what an image is.
async function detectType(path: string) {
	const imageType = await detectSupportedImageMimeTypeFromFile(path);
	if (imageType) return { image: true, mimeType: imageType };
	const mimeType = (await fileTypeFromFile(path))?.mime;
	return mimeType && isMediaType(mimeType) ? { image: false, mimeType } : undefined;
}

// Finds the file that a path names if pi-media attaches it: an existing file of at most `maxBytes`, of an image or media type.
export async function findMediaFile(mention: string, cwd: string, maxBytes: number) {
	const path = await resolveExistingPath(mention, cwd);
	if (!path || !(await isAttachable(path, maxBytes))) return undefined;
	const type = await detectType(path).catch(() => undefined);
	return type && { path, ...type };
}

export async function readAttachment(path: string, mimeType: string): Promise<Attachment> {
	return { path, mimeType, data: (await readFile(path)).toString("base64") };
}

async function attach(mention: string, cwd: string, maxBytes: number): Promise<ImageContent | Attachment | undefined> {
	const file = await findMediaFile(mention, cwd, maxBytes);
	if (!file) return undefined;
	try {
		const attachment = await readAttachment(file.path, file.mimeType);
		return file.image ? { type: "image", data: attachment.data, mimeType: attachment.mimeType } : attachment;
	} catch {
		return undefined;
	}
}

export async function findLocalMedia(text: string, cwd: string, maxBytes: number) {
	let attachedEnd = 0;
	const images: ImageContent[] = [];
	const attachments: Attachment[] = [];
	for (const { start, end, path } of findPathCandidates(text)) {
		if (start < attachedEnd) continue;
		const found = await attach(path, cwd, maxBytes);
		if (!found) continue;
		attachedEnd = end;
		if ("type" in found) images.push(found);
		else attachments.push(found);
	}
	return { images, attachments };
}
