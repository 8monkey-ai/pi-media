import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { findLocalMedia } from "../src/media.ts";
import { fixtureDir, MP3_BYTES, MP4_BYTES, PNG_BYTES, PNG_IMAGE, WAV_BYTES } from "./fixtures.ts";

const NOTHING = { images: [], attachments: [] };

function findMedia(text: string, cwd: string) {
	return findLocalMedia(text, cwd, 20971520);
}

test("attaches an @-mentioned PDF with its bytes", async () => {
	const dir = await fixtureDir({ "report.pdf": "%PDF-1.4" });
	assert.deepEqual(await findMedia("summarize @report.pdf please", dir), {
		images: [],
		attachments: [{ path: join(dir, "report.pdf"), mimeType: "application/pdf", data: "JVBERi0xLjQ=" }],
	});
});

test("detects audio and video types from the bytes, not the extension", async () => {
	const dir = await fixtureDir({ "song.dat": MP3_BYTES, "voice.mp3": WAV_BYTES, "clip.bin": MP4_BYTES });
	assert.deepEqual(await findMedia("@song.dat @voice.mp3 @clip.bin", dir), {
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
	assert.deepEqual(await findMedia('see (@a.mp3), then @"my report.pdf".', dir), {
		images: [],
		attachments: [
			{ path: join(dir, "a.mp3"), mimeType: "audio/mpeg", data: "//uQRAAAAAA=" },
			{ path: join(dir, "my report.pdf"), mimeType: "application/pdf", data: "JVBERi0xLjQ=" },
		],
	});
});

test("returns an @-mentioned image as image content", async () => {
	const dir = await fixtureDir({ "shot.png": PNG_BYTES });
	assert.deepEqual(await findMedia("what is in @shot.png?", dir), { images: [PNG_IMAGE], attachments: [] });
});

test("detects the image type with pi's detector", async () => {
	const dir = await fixtureDir({ "fake.png": "not an image", "photo.heic": "heic bytes" });
	assert.deepEqual(await findMedia("see @fake.png and @photo.heic", dir), NOTHING);
});

test("returns an image and a PDF from one message", async () => {
	const dir = await fixtureDir({ "my shot.png": PNG_BYTES, "report.pdf": "%PDF-1.4" });
	assert.deepEqual(await findMedia('compare @"my shot.png" with @report.pdf', dir), {
		images: [PNG_IMAGE],
		attachments: [{ path: join(dir, "report.pdf"), mimeType: "application/pdf", data: "JVBERi0xLjQ=" }],
	});
});

test("leaves text, other binary types, missing and empty files out", async () => {
	const dir = await fixtureDir({ "notes.md": "# hi", "song.mp3": "not audio", "archive.pdf": "PK\u0003\u0004", "empty.pdf": "" });
	assert.deepEqual(await findMedia("read @notes.md @song.mp3 @archive.pdf @absent.pdf @empty.pdf", dir), NOTHING);
	assert.deepEqual(await findMedia("no mentions here", dir), NOTHING);
});

test("leaves a file larger than the size cap out and attaches a file at the cap", async () => {
	const dir = await fixtureDir({ "big.pdf": "%PDF-1.4 ", "max.pdf": "%PDF-1.4" });
	assert.deepEqual(await findLocalMedia("@big.pdf @max.pdf", dir, 8), {
		images: [],
		attachments: [{ path: join(dir, "max.pdf"), mimeType: "application/pdf", data: "JVBERi0xLjQ=" }],
	});
});

test("ignores an email-like mention that is not a path", async () => {
	const dir = await fixtureDir({});
	assert.deepEqual(await findMedia("mail me at someone@example.com", dir), NOTHING);
});

test("attaches a file that the message names more than one time once", async () => {
	const dir = await fixtureDir({ "a.pdf": "%PDF-1.4", "shot.png": PNG_BYTES });
	assert.deepEqual(await findMedia("@a.pdf and @a.pdf, @shot.png and @./shot.png", dir), {
		images: [PNG_IMAGE],
		attachments: [{ path: join(dir, "a.pdf"), mimeType: "application/pdf", data: "JVBERi0xLjQ=" }],
	});
});
