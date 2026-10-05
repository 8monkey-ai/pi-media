import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { createReadToolDefinition, type ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { createMediaReadTool } from "../src/read-tool.ts";
import { fixtureDir, MP3_BYTES, MP4_BYTES, PNG_BYTES } from "./fixtures.ts";

// The tool reads only `cwd` and `model` from the context.
function context(cwd: string) {
	return { cwd } as ExtensionToolContext;
}

async function readWithMedia(dir: string, path: string, autoResizeImages?: boolean) {
	return createMediaReadTool(() => autoResizeImages).execute("call-1", { path }, undefined, undefined, context(dir));
}

async function readWithPi(dir: string, path: string, autoResizeImages?: boolean) {
	return createReadToolDefinition(dir, { autoResizeImages }).execute("call-1", { path }, undefined, undefined, context(dir));
}

function pngChunk(type: string, data: Buffer) {
	const typed = Buffer.concat([Buffer.from(type), data]);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(typed));
	return Buffer.concat([length, typed, crc]);
}

// A grayscale PNG one row high, wider than the 2000 pixels pi resizes to by default.
function widePng(width: number) {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(1, 4);
	header[8] = 8;
	return Buffer.concat([
		PNG_BYTES.subarray(0, 8),
		pngChunk("IHDR", header),
		pngChunk("IDAT", deflateSync(Buffer.alloc(width + 1))),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}

test("returns a note and keeps the PDF, MP3 and MP4 bytes in the details", async () => {
	const dir = await fixtureDir({ "report.pdf": "%PDF-1.4", "a.mp3": MP3_BYTES, "clip.bin": MP4_BYTES });
	assert.deepEqual(await readWithMedia(dir, "report.pdf"), {
		content: [{ type: "text", text: `Read PDF file [application/pdf]: ${join(dir, "report.pdf")}` }],
		details: { path: join(dir, "report.pdf"), mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
	});
	assert.deepEqual(await readWithMedia(dir, "a.mp3"), {
		content: [{ type: "text", text: `Read audio file [audio/mpeg]: ${join(dir, "a.mp3")}` }],
		details: { path: join(dir, "a.mp3"), mimeType: "audio/mpeg", data: "//uQRAAAAAA=" },
	});
	assert.deepEqual(await readWithMedia(dir, "clip.bin"), {
		content: [{ type: "text", text: `Read video file [video/mp4]: ${join(dir, "clip.bin")}` }],
		details: { path: join(dir, "clip.bin"), mimeType: "video/mp4", data: "AAAAGGZ0eXBtcDQyAAAAAG1wNDJpc29t" },
	});
});

test("returns the same result as pi's read tool for a text file and an image", async () => {
	const dir = await fixtureDir({ "notes.md": "# hi\nthere", "shot.png": PNG_BYTES });
	for (const path of ["notes.md", "shot.png"]) {
		assert.deepEqual(await readWithMedia(dir, path), await readWithPi(dir, path));
	}
	assert.deepEqual((await readWithMedia(dir, "notes.md")).content, [{ type: "text", text: "# hi\nthere" }]);
});

test("does not resize an image when the image auto-resize setting is off", async () => {
	const png = widePng(2400);
	const dir = await fixtureDir({ "wide.png": png });
	const result = await readWithMedia(dir, "wide.png", false);
	assert.deepEqual(result, await readWithPi(dir, "wide.png", false));
	assert.deepEqual(result.content[1], { type: "image", data: png.toString("base64"), mimeType: "image/png" });
	assert.notDeepEqual(await readWithMedia(dir, "wide.png", true), result);
});

test("strips a leading @ from the path, as pi's read tool does", async () => {
	const dir = await fixtureDir({ "a.pdf": "%PDF-1.4" });
	assert.deepEqual(await readWithMedia(dir, "@a.pdf"), {
		content: [{ type: "text", text: `Read PDF file [application/pdf]: ${join(dir, "a.pdf")}` }],
		details: { path: join(dir, "a.pdf"), mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
	});
});

test("passes offset and limit to pi's read tool", async () => {
	const dir = await fixtureDir({ "notes.md": "one\ntwo\nthree" });
	const result = await createMediaReadTool(() => undefined).execute(
		"call-1",
		{ path: "notes.md", offset: 2, limit: 1 },
		undefined,
		undefined,
		context(dir),
	);
	assert.deepEqual(result.content, [{ type: "text", text: "two\n\n[1 more lines in file. Use offset=3 to continue.]" }]);
});

test("fails for a missing file with the error of pi's read tool", async () => {
	const dir = await fixtureDir({});
	const error = { message: `ENOENT: no such file or directory, access '${join(dir, "absent.pdf")}'` };
	await assert.rejects(readWithMedia(dir, "absent.pdf"), error);
	await assert.rejects(readWithPi(dir, "absent.pdf"), error);
});

test("tells the model that the tool also reads audio, video and PDF files", () => {
	assert.match(createMediaReadTool(() => undefined).description, /Also reads audio, video and PDF files\./);
});
