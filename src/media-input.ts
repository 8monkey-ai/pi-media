import { BorderedLoader, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Settings } from "./config.ts";
import type { Attachment } from "./media-entry.ts";
import { type MediaModelSetting, mediaModelFor, progressText, readWithMediaModel } from "./media-model.ts";
import type { MediaTextDetails } from "./media-text.ts";

// The terminal UI shows a loader while the call runs, and Esc on the loader aborts `stop`. Other modes show nothing,
// so the call cannot be stopped there. A stopped message calls no model, so it shows no loader.
function readShowingLoader(file: Attachment, model: MediaModelSetting, ctx: ExtensionContext, stop: AbortController) {
	const read = () => readWithMediaModel(file, model, ctx.modelRegistry, stop.signal);
	if (ctx.mode !== "tui" || stop.signal.aborted) return read();
	return ctx.ui.custom<Awaited<ReturnType<typeof read>>>((tui, theme, _keybindings, done) => {
		const loader = new BorderedLoader(tui, theme, progressText(file, model));
		loader.onAbort = () => stop.abort();
		void read().then(done);
		return loader;
	});
}

// Esc stops the current call and the calls for the files after it.
export async function readWithMediaModels(
	files: Attachment[],
	settings: Settings,
	ctx: ExtensionContext,
	send: (text: string, details: MediaTextDetails) => void,
) {
	const stop = new AbortController();
	const others: Attachment[] = [];
	for (const file of files) {
		const model = mediaModelFor(settings, file.mimeType);
		if (!model) {
			others.push(file);
			continue;
		}
		const { text, error } = await readShowingLoader(file, model, ctx, stop);
		send(text, { error });
	}
	return others;
}
