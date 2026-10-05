import { readFile, stat } from "node:fs/promises";
import { detectSupportedImageMimeTypeFromFile, type InputEvent } from "@earendil-works/pi-coding-agent";
import { fileTypeFromFile } from "file-type";
import { findPathCandidates } from "./find-paths.ts";
import type { Attachment } from "./media-entry.ts";
import { resolveExistingPath } from "./resolve-path.ts";

type ImageContent = NonNullable<InputEvent["images"]>[number];

async function fileSize(path: string) {
	try {
		const stats = await stat(path);
		return stats.isFile() ? stats.size : 0;
	} catch {
		return 0;
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

// Finds the file that a path names if it is an existing, non-empty file of an image or media type.
// The type detectors read only the start of the file, so a large file costs no more than a small one.
export async function findMediaFile(mention: string, cwd: string) {
	const path = await resolveExistingPath(mention, cwd);
	const size = path ? await fileSize(path) : 0;
	if (!path || size === 0) return undefined;
	const type = await detectType(path).catch(() => undefined);
	return type && { path, size, ...type };
}

export async function readAttachment(path: string, mimeType: string): Promise<Attachment> {
	return { path, mimeType, data: (await readFile(path)).toString("base64") };
}

type MediaFile = NonNullable<Awaited<ReturnType<typeof findMediaFile>>>;

async function attach(file: MediaFile): Promise<ImageContent | Attachment | undefined> {
	try {
		const attachment = await readAttachment(file.path, file.mimeType);
		return file.image ? { type: "image", data: attachment.data, mimeType: attachment.mimeType } : attachment;
	} catch {
		return undefined;
	}
}

// Attaches each file once, even when the text names it more than one time.
export async function findLocalMedia(text: string, cwd: string, maxBytes: number) {
	let attachedEnd = 0;
	const attachedPaths = new Set<string>();
	const images: ImageContent[] = [];
	const attachments: Attachment[] = [];
	for (const { start, end, path } of findPathCandidates(text)) {
		if (start < attachedEnd) continue;
		const file = await findMediaFile(path, cwd);
		if (!file || file.size > maxBytes) continue;
		if (attachedPaths.has(file.path)) {
			attachedEnd = end;
			continue;
		}
		const found = await attach(file);
		if (!found) continue;
		attachedEnd = end;
		attachedPaths.add(file.path);
		if ("type" in found) images.push(found);
		else attachments.push(found);
	}
	return { images, attachments };
}
