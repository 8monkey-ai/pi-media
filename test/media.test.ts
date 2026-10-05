import assert from "node:assert/strict";
import { truncate } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { findLocalMedia } from "../src/media.ts";
import { fixtureDir, MP3_BYTES, MP4_BYTES, PNG_BYTES, WAV_BYTES } from "./fixtures.ts";

const PNG_IMAGE = { type: "image", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ", mimeType: "image/png" };
const NOTHING = { images: [], attachments: [] };

test("attaches an @-mentioned PDF with its bytes", async () => {
	const dir = await fixtureDir({ "report.pdf": "%PDF-1.4" });
	assert.deepEqual(await findLocalMedia("summarize @report.pdf please", dir), {
		images: [],
		attachments: [{ path: join(dir, "report.pdf"), mimeType: "application/pdf", data: "JVBERi0xLjQ=" }],
	});
});

test("detects audio and video types from the bytes, not the extension", async () => {
	const dir = await fixtureDir({ "song.dat": MP3_BYTES, "voice.mp3": WAV_BYTES, "clip.bin": MP4_BYTES });
	assert.deepEqual(await findLocalMedia("@song.dat @voice.mp3 @clip.bin", dir), {
		images: [],
		attachments: [
			{ path: join(dir, "song.dat"), mimeType: "audio/mpeg", data: "//uQRAAAAAA=" },
			{ path: join(dir, "voice.mp3"), mimeType: "audio/wav", data: "UklGRiQAAABXQVZFZm10IA==" },
			{ path: join(dir, "clip.bin"), mimeType: "video/mp4", data: "AAAAGGZ0eXBtcDQyAAAAAG1wNDJpc29t" },
		],
	});
});

test("attaches quoted paths with spaces and keeps trailing punctuation outside the mention", async () => {
	const dir = await fixtureDir({ "my report.pdf": "%PDF-1.4", "a.mp3": MP3_BYTES });
	assert.deepEqual(await findLocalMedia('see (@a.mp3), then @"my report.pdf".', dir), {
		images: [],
		attachments: [
			{ path: join(dir, "a.mp3"), mimeType: "audio/mpeg", data: "//uQRAAAAAA=" },
			{ path: join(dir, "my report.pdf"), mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
		],
	});
});

test("returns an @-mentioned image as image content", async () => {
	const dir = await fixtureDir({ "shot.png": PNG_BYTES });
	assert.deepEqual(await findLocalMedia("what is in @shot.png?", dir), { images: [PNG_IMAGE], attachments: [] });
});

test("detects the image type with pi's detector", async () => {
	const dir = await fixtureDir({ "fake.png": "not an image", "photo.heic": "heic bytes" });
	assert.deepEqual(await findLocalMedia("see @fake.png and @photo.heic", dir), NOTHING);
});

test("returns an image and a PDF from one message", async () => {
	const dir = await fixtureDir({ "my shot.png": PNG_BYTES, "report.pdf": "%PDF-1.4" });
	assert.deepEqual(await findLocalMedia('compare @"my shot.png" with @report.pdf', dir), {
		images: [PNG_IMAGE],
		attachments: [{ path: join(dir, "report.pdf"), mimeType: "application/pdf", data: "JVBERi0xLjQ=" }],
	});
});

test("leaves text, other binary types, missing and empty files out", async () => {
	const dir = await fixtureDir({ "notes.md": "# hi", "song.mp3": "not audio", "archive.pdf": "PK\u0003\u0004", "empty.pdf": "" });
	assert.deepEqual(await findLocalMedia("read @notes.md @song.mp3 @archive.pdf @absent.pdf @empty.pdf", dir), NOTHING);
	assert.deepEqual(await findLocalMedia("no mentions here", dir), NOTHING);
});

test("leaves a file larger than 20 MB out", async () => {
	const dir = await fixtureDir({ "big.pdf": "%PDF-1.4", "max.pdf": "%PDF-1.4" });
	await truncate(join(dir, "big.pdf"), 20 * 1024 * 1024 + 1);
	await truncate(join(dir, "max.pdf"), 20 * 1024 * 1024);
	const { attachments } = await findLocalMedia("@big.pdf @max.pdf", dir);
	assert.deepEqual(
		attachments.map(({ path, mimeType }) => ({ path, mimeType })),
		[{ path: join(dir, "max.pdf"), mimeType: "application/pdf" }],
	);
});

test("ignores an email-like mention that is not a path", async () => {
	const dir = await fixtureDir({});
	assert.deepEqual(await findLocalMedia("mail me at someone@example.com", dir), NOTHING);
});
