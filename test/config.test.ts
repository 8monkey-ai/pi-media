import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, type Message } from "@earendil-works/pi-ai";
import { readMaxAttachmentBytes } from "../src/config.ts";
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

test("uses 20 MB when the config file is missing", () => {
	assert.equal(readMaxAttachmentBytes(), 20971520);
});

test("uses 20 MB when the config file has no maxAttachmentBytes and ignores other keys", async () => {
	await writeConfig('{"other": true}');
	assert.equal(readMaxAttachmentBytes(), 20971520);
});

test("reads maxAttachmentBytes from pi-media.json in the agent directory", async () => {
	await writeConfig('{"maxAttachmentBytes": 1048576}');
	assert.equal(readMaxAttachmentBytes(), 1048576);
});

test("fails with the file path when the config file is not valid JSON", async () => {
	await writeConfig("{maxAttachmentBytes: 5}");
	assert.throws(() => readMaxAttachmentBytes(), {
		message: new RegExp(`^pi-media: ${join(agentDir, "pi-media.json")} is not valid JSON: `),
	});
});

test("fails with the file path when the config file does not hold a JSON object", async () => {
	for (const content of ["null", "[]", "5"]) {
		await writeConfig(content);
		assert.throws(() => readMaxAttachmentBytes(), {
			message: `pi-media: ${join(agentDir, "pi-media.json")} must hold a JSON object`,
		});
	}
});

test("fails with the file path when maxAttachmentBytes is not a positive integer", async () => {
	for (const value of ["0", "-1", "1.5", '"20MB"', "null"]) {
		await writeConfig(`{"maxAttachmentBytes": ${value}}`);
		assert.throws(() => readMaxAttachmentBytes(), {
			message: `pi-media: maxAttachmentBytes in ${join(agentDir, "pi-media.json")} must be a positive integer, got ${value}`,
		});
	}
});

// The model reads big.pdf and max.pdf with the read tool, then answers.
function readBothThenAnswer(messages: Message[]) {
	if (messages.at(-1)?.role !== "user") return fauxAssistantMessage("ok");
	return fauxAssistantMessage(
		[fauxToolCall("read", { path: "big.pdf" }, { id: "call-1" }), fauxToolCall("read", { path: "max.pdf" }, { id: "call-2" })],
		{ stopReason: "toolUse" },
	);
}

test("applies maxAttachmentBytes to paths in the message and to the read tool", async () => {
	const { session, dir, settle } = await startSession([extension], {
		files: { "pi-media.json": '{"maxAttachmentBytes": 8}', "big.pdf": "%PDF-1.4 ", "max.pdf": "%PDF-1.4" },
		tools: ["read"],
		reply: readBothThenAnswer,
	});
	await settle(session.prompt("compare @big.pdf @max.pdf"));
	const branch = session.sessionManager.getBranch();
	assert.deepEqual(
		branch.flatMap((entry) => (entry.type === "custom" ? [entry.data] : [])),
		[
			{
				text: "compare @big.pdf @max.pdf",
				attachments: [{ path: join(dir, "max.pdf"), mimeType: "application/pdf", data: "JVBERi0xLjQ=" }],
			},
		],
	);
	assert.deepEqual(
		branch.flatMap((entry) => (entry.type === "message" && entry.message.role === "toolResult" ? [entry.message.content] : [])),
		[[{ type: "text", text: "%PDF-1.4 " }], [{ type: "text", text: `Read PDF file [application/pdf]: ${join(dir, "max.pdf")}` }]],
	);
});
