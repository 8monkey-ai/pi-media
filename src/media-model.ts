import { basename } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type MediaKind, mediaModels, type Settings } from "./config.ts";
import { mediaApi } from "./media-apis.ts";
import type { Attachment } from "./media-entry.ts";
import { mediaText } from "./media-text.ts";

const KINDS: Record<MediaKind, { instruction: string; verb: string; progress: string; heading: string }> = {
	image: {
		instruction: "Describe this image. Then give all text that is in the image, word for word.",
		verb: "describe",
		progress: "Describing",
		heading: "Description",
	},
	audio: {
		instruction: "Transcribe this audio word for word. Give only the transcript.",
		verb: "transcribe",
		progress: "Transcribing",
		heading: "Transcript",
	},
	document: {
		instruction:
			"Give the full text of this document. In the place of each image or chart, give a description of the image or chart.",
		verb: "read",
		progress: "Reading",
		heading: "Text",
	},
};

export type MediaModelSetting = ReturnType<typeof mediaModels>[number];

function kindOf(mimeType: string): MediaKind | undefined {
	if (mimeType.startsWith("image/")) return "image";
	if (mimeType.startsWith("audio/")) return "audio";
	return mimeType === "application/pdf" ? "document" : undefined;
}

export const mediaModelFor = (settings: Settings, mimeType: string) =>
	mediaModels(settings).find(({ kind }) => kind === kindOf(mimeType));

const modelName = ({ provider, id }: MediaModelSetting) => `${provider}/${id}`;

export const progressText = (file: Attachment, model: MediaModelSetting) =>
	`${KINDS[model.kind].progress} ${basename(file.path)} with ${modelName(model)}…`;

// Node's `fetch` gives the cause of a network failure, such as a timeout, only in `cause`.
function reasonOf(error: unknown, signal: AbortSignal) {
	if (signal.aborted) return "The user stopped the call.";
	const { message, cause } = error instanceof Error ? error : new Error(String(error));
	const reason = cause instanceof Error ? `${message}: ${cause.message}` : message;
	return /[.!?]$/.test(reason) ? reason : `${reason}.`;
}

export async function readWithMediaModel(
	file: Attachment,
	model: MediaModelSetting,
	registry: ExtensionContext["modelRegistry"],
	signal: AbortSignal,
) {
	const { instruction, verb, heading } = KINDS[model.kind];
	const name = basename(file.path);
	try {
		signal.throwIfAborted();
		const call = { file, provider: model.provider, id: model.id, instruction, signal };
		const text = await mediaApi(model.api).read(call, registry);
		if (text.trim() === "") throw new Error("the model gave no text");
		return { text: mediaText(`${heading} of ${name} · ${modelName(model)}`, text), error: false };
	} catch (error) {
		return { text: `pi-media: ${modelName(model)} could not ${verb} ${name}: ${reasonOf(error, signal)}`, error: true };
	}
}
