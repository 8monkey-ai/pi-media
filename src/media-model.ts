import { basename } from "node:path";
import { BorderedLoader, type ExtensionContext, type ModelRegistry } from "@earendil-works/pi-coding-agent";
import { mediaModels, type Settings } from "./config.ts";
import type { Attachment } from "./media-entry.ts";
import { readWithChatModel } from "./openai-completions-api.ts";
import { transcribe } from "./openai-transcriptions-api.ts";

const KINDS = {
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

type MediaModel = ReturnType<typeof mediaModels>[number];
type Note = { text: string; error: boolean };

function kindOf(mimeType: string) {
	if (mimeType.startsWith("image/")) return "image";
	if (mimeType.startsWith("audio/")) return "audio";
	return mimeType === "application/pdf" ? "document" : undefined;
}

export const modelName = ({ provider, id }: MediaModel) => `${provider}/${id}`;

export const mediaModelFor = (settings: Settings, mimeType: string) =>
	mediaModels(settings).find(({ kind }) => kind === kindOf(mimeType));

// Node's `fetch` gives the cause of a network failure, such as a timeout, only in `cause`.
function reasonOf(error: unknown, signal: AbortSignal) {
	if (signal.aborted) return "The user stopped the call.";
	const { message, cause } = error instanceof Error ? error : new Error(String(error));
	const reason = cause instanceof Error ? `${message}: ${cause.message}` : message;
	return /[.!?]$/.test(reason) ? reason : `${reason}.`;
}

export async function readWithMediaModel(file: Attachment, model: MediaModel, registry: ModelRegistry, signal: AbortSignal) {
	const { instruction, verb, heading } = KINDS[model.kind];
	const name = basename(file.path);
	try {
		signal.throwIfAborted();
		// The settings allow only these two APIs, so the set is closed and needs no registry.
		const text =
			model.api === "openai-completions"
				? await readWithChatModel(file, model.provider, model.id, instruction, registry, signal)
				: await transcribe(file, model.provider, model.id, registry, signal);
		if (text.trim() === "") throw new Error("the model gave no text");
		return { text: `${heading} of ${name} · ${modelName(model)}\n\n${text}`, error: false };
	} catch (error) {
		return { text: `pi-media: ${modelName(model)} could not ${verb} ${name}: ${reasonOf(error, signal)}`, error: true };
	}
}

// The terminal UI shows a loader while the call runs, and Esc on the loader aborts `stop`. Other modes show nothing,
// so the call cannot be stopped there. A stopped message calls no model, so it shows no loader.
function readShowingLoader(file: Attachment, model: MediaModel, ctx: ExtensionContext, stop: AbortController) {
	const read = () => readWithMediaModel(file, model, ctx.modelRegistry, stop.signal);
	if (ctx.mode !== "tui" || stop.signal.aborted) return read();
	const progress = `${KINDS[model.kind].progress} ${basename(file.path)} with ${modelName(model)}…`;
	return ctx.ui.custom<Note>((tui, theme, _keybindings, done) => {
		const loader = new BorderedLoader(tui, theme, progress);
		loader.onAbort = () => stop.abort();
		void read().then(done);
		return loader;
	});
}

// Gives the files of types without a media model. Esc stops the current call and the calls for the files after it.
export async function readWithMediaModels(
	files: Attachment[],
	settings: Settings,
	ctx: ExtensionContext,
	send: (note: Note) => void,
) {
	const stop = new AbortController();
	const others: Attachment[] = [];
	for (const file of files) {
		const model = mediaModelFor(settings, file.mimeType);
		if (model) send(await readShowingLoader(file, model, ctx, stop));
		else others.push(file);
	}
	return others;
}
