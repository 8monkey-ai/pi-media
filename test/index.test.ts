import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { fixtureDir, PNG_BYTES } from "./fixtures.ts";

type InputHandler = (event: unknown, ctx: { cwd: string }) => Promise<unknown>;

function inputHandler() {
	const handlers = new Map<string, InputHandler>();
	// The extension calls only `on`, so a partial API is enough here.
	extension({ on: (name: string, handler: InputHandler) => handlers.set(name, handler) } as unknown as ExtensionAPI);
	const handler = handlers.get("input");
	assert.ok(handler);
	return handler;
}

test("adds mentioned images after the images already in the input", async () => {
	const cwd = await fixtureDir({ "shot.png": PNG_BYTES });
	const existing = { type: "image", data: "AAAA", mimeType: "image/jpeg" };
	assert.deepEqual(await inputHandler()({ text: "see @shot.png", images: [existing], source: "interactive" }, { cwd }), {
		action: "transform",
		text: "see @shot.png",
		images: [
			{ type: "image", data: "AAAA", mimeType: "image/jpeg" },
			{ type: "image", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ", mimeType: "image/png" },
		],
	});
});

test("continues when the input mentions no media", async () => {
	const cwd = await fixtureDir({});
	assert.deepEqual(await inputHandler()({ text: "hello", source: "interactive" }, { cwd }), { action: "continue" });
});

test("attaches a pi clipboard image path from every input source", async () => {
	const dir = await fixtureDir({ "pi-clipboard-3f2b8c1e-5d4a-4e7b-9a6c-1b2d3e4f5a6b.png": PNG_BYTES });
	const text = join(dir, "pi-clipboard-3f2b8c1e-5d4a-4e7b-9a6c-1b2d3e4f5a6b.png");
	for (const source of ["interactive", "rpc", "extension"]) {
		assert.deepEqual(await inputHandler()({ text, source }, { cwd: "/" }), {
			action: "transform",
			text,
			images: [{ type: "image", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ", mimeType: "image/png" }],
		});
	}
});
