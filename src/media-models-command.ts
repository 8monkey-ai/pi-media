import type { ExtensionContext, RegisteredCommand } from "@earendil-works/pi-coding-agent";
import { MEDIA_KINDS, type MediaKind, type MediaModel, type MediaSetting, type Settings, saveMediaModel } from "./config.ts";

type ModelName = Pick<MediaModel, "provider" | "id">;

const KINDS = {
	image: { name: "Image", files: "images" },
	audio: { name: "Audio", files: "audio files" },
	document: { name: "Document", files: "PDF files" },
} satisfies Record<MediaKind, { name: string; files: string }>;

const API_ROWS = {
	"openai-completions": "openai-completions      (default)  /chat/completions",
	"openai-transcriptions": "openai-transcriptions              /audio/transcriptions",
} satisfies Record<MediaModel["api"], string>;
const apiRows = new Map(Object.entries(API_ROWS).map(([api, row]) => [row, api as MediaModel["api"]]));

const label = ({ provider, id }: ModelName) => `${provider}/${id}`;

// `select` returns the row text, or `undefined` on Esc, so each dialog maps rows to values.
async function selectRow<T>(ctx: ExtensionContext, title: string, rows: Map<string, T>) {
	const row = await ctx.ui.select(title, [...rows.keys()]);
	return row === undefined ? undefined : rows.get(row);
}

function selectKind(ctx: ExtensionContext, settings: Settings) {
	const rows = new Map(
		MEDIA_KINDS.map((kind) => {
			const model = settings[`${kind}Model`];
			return [`${KINDS[kind].name.padEnd(11)}${model ? label(model) : "not set"}`, kind];
		}),
	);
	return selectRow(ctx, "Media models", rows);
}

// The current model is in the list also when pi does not list it, for example a typed transcription model.
function modelRows(available: ModelName[], current: ModelName | undefined) {
	const isCurrent = (model: ModelName) => model.provider === current?.provider && model.id === current.id;
	const models = current && !available.some(isCurrent) ? [...available, current] : available;
	const mark = (text: string, marked: boolean) => (marked ? `${text}  ✓` : text);
	return new Map<string, ModelName | "not set" | "type">([
		[mark("Not set", !current), "not set"],
		...models.map((model) => [mark(label(model), isCurrent(model)), model] as const),
		["Type a model…", "type"],
	]);
}

function parseTypedModel(ctx: ExtensionContext, text: string) {
	const slash = text.indexOf("/");
	const model = { provider: text.slice(0, slash), id: text.slice(slash + 1) };
	if (slash < 1 || !model.id) return "Type the model as provider/model-id, for example hebo/gpt-transcribe.";
	if (!ctx.modelRegistry.getProvider(model.provider)) {
		return `pi has no provider "${model.provider}". Add it in models.json or with an extension.`;
	}
	return model;
}

async function typeModel(ctx: ExtensionContext, name: string) {
	for (;;) {
		const text = await ctx.ui.input(`${name} model (provider/model-id)`);
		if (text === undefined) return undefined;
		const modelOrError = parseTypedModel(ctx, text.trim());
		if (typeof modelOrError !== "string") return modelOrError;
		ctx.ui.notify(modelOrError, "error");
	}
}

async function selectModel(ctx: ExtensionContext, name: string, current: ModelName | undefined) {
	const selected = await selectRow(ctx, `${name} model`, modelRows(ctx.modelRegistry.getAvailable(), current));
	if (selected === undefined || selected === "not set") return selected;
	const model = selected === "type" ? await typeModel(ctx, name) : selected;
	if (model === undefined) return undefined;
	const api = await selectRow(ctx, `API for ${label(model)}`, apiRows);
	return api && { provider: model.provider, id: model.id, api };
}

export function mediaModelsCommand(
	path: string,
	settings: Settings,
	applySettings: (ctx: ExtensionContext) => void,
): Omit<RegisteredCommand, "name" | "sourceInfo"> {
	return {
		description: "Set the models that read images, audio and PDF files",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				console.error(`pi-media: /media-models needs the terminal UI. Set the media models in ${path}.`);
				return;
			}
			const kind = await selectKind(ctx, settings);
			if (kind === undefined) return;
			const { name, files } = KINDS[kind];
			const setting: MediaSetting = `${kind}Model`;
			const model = await selectModel(ctx, name, settings[setting]);
			if (model === undefined) return;
			saveMediaModel(path, settings, setting, model === "not set" ? undefined : model);
			const change =
				model === "not set"
					? `${name} model removed. pi-media attaches ${files} to the main model.`
					: `${name} model: ${label(model)} (${model.api}).`;
			ctx.ui.notify(`${change}\nSaved to ${path}`, "info");
			applySettings(ctx);
		},
	};
}
