import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import type { TLocalizedValidationError } from "typebox/error";
import { Value } from "typebox/value";
import { isRecord } from "./is-record.ts";

export const MEDIA_KINDS = ["image", "audio", "document"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export type MediaSetting = `${MediaKind}Model`;

const MediaModel = Type.Object({
	provider: Type.String({ minLength: 1 }),
	id: Type.String({ minLength: 1 }),
	api: Type.Enum(["openai-completions", "openai-transcriptions"]),
});

// Files above `maxAttachmentBytes` stay as text: pi-media holds each attachment in memory as base64.
const Settings = Type.Object({
	maxAttachmentBytes: Type.Optional(Type.Integer({ minimum: 1 })),
	imageModel: Type.Optional(MediaModel),
	audioModel: Type.Optional(MediaModel),
	documentModel: Type.Optional(MediaModel),
});
export type Settings = Static<typeof Settings> & { maxAttachmentBytes: number };
export type MediaModel = Static<typeof MediaModel>;

// Pi has no settings section for extensions, so pi-media keeps its settings in a file of its own.
function readConfigFile(path: string) {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function parseConfig(path: string, text: string) {
	let config: unknown;
	try {
		config = JSON.parse(text);
	} catch (error) {
		throw new Error(`pi-media: ${path} is not valid JSON: ${(error as Error).message}`);
	}
	if (!isRecord(config) || Array.isArray(config)) {
		throw new Error(`pi-media: ${path} must hold a JSON object`);
	}
	return config;
}

function describeError(path: string, config: unknown, error: TLocalizedValidationError) {
	const setting = `${error.instancePath.slice(1).replaceAll("/", ".")} in ${path}`;
	if (error.keyword === "required") {
		return `pi-media: ${setting} has no ${error.params.requiredProperties.map((field) => `"${field}"`).join(", ")}`;
	}
	const rule =
		error.keyword === "enum"
			? `must be ${error.params.allowedValues.map((value) => JSON.stringify(value)).join(" or ")}`
			: error.message;
	return `pi-media: ${setting} ${rule}, got ${JSON.stringify(Value.Pointer.Get(config, error.instancePath))}`;
}

function readConfig(path: string) {
	const text = readConfigFile(path);
	return text === undefined ? {} : parseConfig(path, text);
}

export function readSettings() {
	const path = join(getAgentDir(), "pi-media.json");
	const config = readConfig(path);
	if (!Value.Check(Settings, config)) throw new Error(describeError(path, config, Value.Errors(Settings, config)[0]));
	const settings: Settings = { ...config, maxAttachmentBytes: config.maxAttachmentBytes ?? 20 * 1024 * 1024 };
	return { path, settings };
}

// Reads the file again, so that the other keys stay as the file has them. `settings` changes only after the write succeeds.
export function saveMediaModel(path: string, settings: Settings, setting: MediaSetting, model: MediaModel | undefined) {
	const update = (record: Record<string, unknown>) => {
		if (model === undefined) delete record[setting];
		else record[setting] = model;
	};
	const config = readConfig(path);
	update(config);
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
	update(settings);
}

export function mediaModels(settings: Settings) {
	return MEDIA_KINDS.flatMap((kind) => {
		const setting = `${kind}Model` as const;
		const model = settings[setting];
		return model ? [{ kind, setting, ...model }] : [];
	});
}
