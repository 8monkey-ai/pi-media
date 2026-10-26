import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { readSettings } from "../src/config.ts";
import extension from "../src/index.ts";
import { startSession } from "./session-harness.ts";

let agentDir: string;
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;

beforeEach(async () => {
	agentDir = await mkdtemp(join(tmpdir(), "pi-media-agent-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
});

async function writeConfig(content: string) {
	await writeFile(join(agentDir, "pi-media.json"), content);
}

const configPath = () => join(agentDir, "pi-media.json");

test("uses 20 MB and no media models when the config file is missing", () => {
	assert.deepEqual(readSettings(), { path: configPath(), settings: { maxAttachmentBytes: 20971520 } });
});

test("uses 20 MB when the config file has no maxAttachmentBytes and ignores other keys", async () => {
	await writeConfig('{"other": true}');
	assert.equal(readSettings().settings.maxAttachmentBytes, 20971520);
});

test("reads maxAttachmentBytes and the media models from pi-media.json in the agent directory", async () => {
	await writeConfig(
		JSON.stringify({
			maxAttachmentBytes: 1048576,
			imageModel: { provider: "hebo", id: "gpt-4.1-mini", api: "openai-completions" },
			audioModel: { provider: "hebo", id: "gpt-transcribe", api: "openai-transcriptions" },
			documentModel: { provider: "hebo", id: "gpt-4.1", api: "openai-completions" },
		}),
	);
	assert.deepEqual(readSettings().settings, {
		maxAttachmentBytes: 1048576,
		imageModel: { provider: "hebo", id: "gpt-4.1-mini", api: "openai-completions" },
		audioModel: { provider: "hebo", id: "gpt-transcribe", api: "openai-transcriptions" },
		documentModel: { provider: "hebo", id: "gpt-4.1", api: "openai-completions" },
	});
});

test("fails when the config path exists but cannot be read as a file", async () => {
	await mkdir(configPath());
	assert.throws(() => readSettings(), { code: "EISDIR" });
});

test("fails with the file path when the config file is not valid JSON", async () => {
	await writeConfig("{maxAttachmentBytes: 5}");
	assert.throws(() => readSettings(), {
		message: new RegExp(`^pi-media: ${configPath()} is not valid JSON: `),
	});
});

test("fails with the file path when the config file does not hold a JSON object", async () => {
	for (const content of ["null", "[]", "5"]) {
		await writeConfig(content);
		assert.throws(() => readSettings(), { message: `pi-media: ${configPath()} must hold a JSON object` });
	}
});

test("fails with the setting and the file path when maxAttachmentBytes is not a positive integer", async () => {
	for (const [value, rule] of [
		["0", "must be >= 1"],
		["-1", "must be >= 1"],
		["1.5", "must be integer"],
		['"20MB"', "must be integer"],
		["null", "must be integer"],
	]) {
		await writeConfig(`{"maxAttachmentBytes": ${value}}`);
		assert.throws(() => readSettings(), { message: `pi-media: maxAttachmentBytes in ${configPath()} ${rule}, got ${value}` });
	}
});

test("fails with the setting and the file path when a media model has no provider, id or api", async () => {
	for (const [model, missing] of [
		['{"provider": "hebo", "id": "gpt-transcribe"}', '"api"'],
		['{"provider": "hebo"}', '"id", "api"'],
		["{}", '"provider", "id", "api"'],
	]) {
		await writeConfig(`{"audioModel": ${model}}`);
		assert.throws(() => readSettings(), { message: `pi-media: audioModel in ${configPath()} has no ${missing}` });
	}
});

test("fails with the setting and the file path when a media model has a value of the wrong type", async () => {
	for (const [model, field, rule] of [
		[
			'{"provider": "hebo", "id": "gpt-4.1", "api": "openai-responses"}',
			"imageModel.api",
			'must be "openai-completions" or "openai-transcriptions", got "openai-responses"',
		],
		['{"provider": 5, "id": "gpt-4.1", "api": "openai-completions"}', "imageModel.provider", "must be string, got 5"],
		['"hebo/gpt-4.1"', "imageModel", 'must be object, got "hebo/gpt-4.1"'],
		["null", "imageModel", "must be object, got null"],
	]) {
		await writeConfig(`{"imageModel": ${model}}`);
		assert.throws(() => readSettings(), { message: `pi-media: ${field} in ${configPath()} ${rule}` });
	}
});

test("fails with the setting and the file path when a media model has an empty provider or id", async () => {
	for (const [model, field] of [
		['{"provider": "", "id": "gpt-4.1", "api": "openai-completions"}', "documentModel.provider"],
		['{"provider": "hebo", "id": "", "api": "openai-completions"}', "documentModel.id"],
	]) {
		await writeConfig(`{"documentModel": ${model}}`);
		assert.throws(() => readSettings(), {
			message: `pi-media: ${field} in ${configPath()} must not have fewer than 1 characters, got ""`,
		});
	}
});

test("applies maxAttachmentBytes from pi-media.json to paths in the message", async () => {
	const { session, dir, settle } = await startSession([extension], {
		files: { "pi-media.json": '{"maxAttachmentBytes": 8}', "big.pdf": "%PDF-1.4 ", "max.pdf": "%PDF-1.4" },
	});
	await settle(session.prompt("compare @big.pdf @max.pdf"));
	assert.deepEqual(
		session.sessionManager.getBranch().flatMap((entry) => (entry.type === "custom" ? [entry.data] : [])),
		[
			{
				text: "compare @big.pdf @max.pdf",
				attachments: [{ path: join(dir, "max.pdf"), mimeType: "application/pdf", data: "JVBERi0xLjQ=" }],
			},
		],
	);
});
