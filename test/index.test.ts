import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionFactory, InputEvent } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { PNG_BYTES, PNG_IMAGE } from "./fixtures.ts";
import { startSession } from "./session-harness.ts";

// Runs after pi-media and records the input that pi-media passes on.
function inputObserver() {
	const inputs: Pick<InputEvent, "text" | "images">[] = [];
	const observer: ExtensionFactory = (pi) => {
		pi.on("input", ({ text, images }) => {
			inputs.push({ text, images });
			return { action: "continue" };
		});
	};
	return { inputs, observer };
}

test("passes mentioned images to pi after the images already in the input and keeps the text", async () => {
	const { inputs, observer } = inputObserver();
	const { session, settle } = await startSession([extension, observer], { files: { "shot.png": PNG_BYTES } });
	const existing = { type: "image" as const, data: "AAAA", mimeType: "image/jpeg" };
	await settle(session.prompt("see @shot.png", { images: [existing] }));
	assert.deepEqual(inputs, [{ text: "see @shot.png", images: [existing, PNG_IMAGE] }]);
});

test("attaches from every input source", async () => {
	const { inputs, observer } = inputObserver();
	const { session, settle } = await startSession([extension, observer], { files: { "shot.png": PNG_BYTES } });
	for (const source of ["interactive", "rpc", "extension"] as const) await settle(session.prompt("@shot.png", { source }));
	assert.deepEqual(inputs, [
		{ text: "@shot.png", images: [PNG_IMAGE] },
		{ text: "@shot.png", images: [PNG_IMAGE] },
		{ text: "@shot.png", images: [PNG_IMAGE] },
	]);
});

test("passes input without media on unchanged", async () => {
	const { inputs, observer } = inputObserver();
	const { session, settle } = await startSession([extension, observer]);
	await settle(session.prompt("hello"));
	assert.deepEqual(inputs, [{ text: "hello", images: undefined }]);
});
