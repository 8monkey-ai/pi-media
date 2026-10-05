import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

// Pi has no settings section for extensions, so pi-media keeps its settings in a file of its own.
function readConfigFile(path: string) {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function parseConfig(path: string, text: string): Record<string, unknown> {
	let config: unknown;
	try {
		config = JSON.parse(text);
	} catch (error) {
		throw new Error(`pi-media: ${path} is not valid JSON: ${(error as Error).message}`);
	}
	if (typeof config !== "object" || config === null || Array.isArray(config)) {
		throw new Error(`pi-media: ${path} must hold a JSON object`);
	}
	return config as Record<string, unknown>;
}

// Files above the cap stay as text: pi-media holds each attachment in memory as base64.
export function readMaxAttachmentBytes() {
	const path = join(getAgentDir(), "pi-media.json");
	const text = readConfigFile(path);
	const value = text === undefined ? undefined : parseConfig(path, text).maxAttachmentBytes;
	if (value === undefined) return 20 * 1024 * 1024;
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		throw new Error(`pi-media: maxAttachmentBytes in ${path} must be a positive integer, got ${JSON.stringify(value)}`);
	}
	return value;
}
