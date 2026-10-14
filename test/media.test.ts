import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { attachLocalMedia, makeMarker, splitMarkers } from "../src/media.ts";
import { fixtureDir, PNG_BYTES, PNG_IMAGE } from "./fixtures.ts";

test("attaches an @-mentioned media file", async () => {
	const dir = await fixtureDir({ "report.pdf": "%PDF-1.4" });
	assert.deepEqual(await attachLocalMedia("summarize @report.pdf please", dir), {
		text: `summarize ${makeMarker(join(dir, "report.pdf"), "application/pdf")} please`,
		images: [],
	});
});

test("attaches quoted paths with spaces and multiple mentions", async () => {
	const dir = await fixtureDir({ "my report.pdf": "%PDF-1.4", "clip.mp3": "mp3" });
	assert.deepEqual(await attachLocalMedia('@"my report.pdf" and @clip.mp3', dir), {
		text: `${makeMarker(join(dir, "my report.pdf"), "application/pdf")} and ${makeMarker(join(dir, "clip.mp3"), "audio/mpeg")}`,
		images: [],
	});
});

test("keeps trailing punctuation outside the mention", async () => {
	const dir = await fixtureDir({ "invoice.pdf": "%PDF-1.4", "a.mp3": "mp3" });
	const marker = makeMarker(join(dir, "invoice.pdf"), "application/pdf");
	assert.deepEqual(await attachLocalMedia("what is in @invoice.pdf?", dir), { text: `what is in ${marker}?`, images: [] });
	assert.deepEqual(await attachLocalMedia("see (@a.mp3), then @invoice.pdf.", dir), {
		text: `see (${makeMarker(join(dir, "a.mp3"), "audio/mpeg")}), then ${marker}.`,
		images: [],
	});
});

test("returns an @-mentioned image as image content and keeps the text as typed", async () => {
	const dir = await fixtureDir({ "shot.png": PNG_BYTES });
	assert.deepEqual(await attachLocalMedia("what is in @shot.png?", dir), { text: "what is in @shot.png?", images: [PNG_IMAGE] });
});

// A 1x1 24-bit BMP: file header, BITMAPINFOHEADER and one padded pixel row.
const BMP_BYTES = Buffer.alloc(58);
BMP_BYTES.write("BM");
BMP_BYTES.writeUInt32LE(58, 2);
BMP_BYTES.writeUInt32LE(54, 10);
BMP_BYTES.writeUInt32LE(40, 14);
BMP_BYTES.writeInt32LE(1, 18);
BMP_BYTES.writeInt32LE(1, 22);
BMP_BYTES.writeUInt16LE(1, 26);
BMP_BYTES.writeUInt16LE(24, 28);
BMP_BYTES.writeUInt32LE(4, 34);

// The ftyp box at the start of a HEIC file.
const HEIC_BYTES = Buffer.concat([
	Buffer.from([0, 0, 0, 0x18]),
	Buffer.from("ftypheic"),
	Buffer.alloc(4),
	Buffer.from("mif1heic"),
]);

test("detects the image type with pi's detector", async () => {
	const dir = await fixtureDir({ "fake.png": "not an image", "photo.heic": HEIC_BYTES, "pic.dat": BMP_BYTES });
	const text = "see @fake.png, @photo.heic and @pic.dat";
	assert.deepEqual(await attachLocalMedia(text, dir), {
		text,
		images: [
			{
				type: "image",
				data: "Qk06AAAAAAAAADYAAAAoAAAAAQAAAAEAAAABABgAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
				mimeType: "image/bmp",
			},
		],
	});
});

test("returns an image and a PDF from one message", async () => {
	const dir = await fixtureDir({ "my shot.png": PNG_BYTES, "report.pdf": "%PDF-1.4" });
	assert.deepEqual(await attachLocalMedia('compare @"my shot.png" with @report.pdf', dir), {
		text: `compare @"my shot.png" with ${makeMarker(join(dir, "report.pdf"), "application/pdf")}`,
		images: [PNG_IMAGE],
	});
});

test("leaves files without a supported extension, missing and empty files untouched", async () => {
	const dir = await fixtureDir({ "notes.md": "# hi", "script.sh": "echo", "empty.pdf": "", "report.docx": "x" });
	assert.equal(await attachLocalMedia("read @notes.md and @script.sh", dir), undefined);
	assert.equal(await attachLocalMedia("open @report.docx", dir), undefined);
	assert.equal(await attachLocalMedia("see @absent.pdf", dir), undefined);
	assert.equal(await attachLocalMedia("@empty.pdf", dir), undefined);
	assert.equal(await attachLocalMedia("no mentions here", dir), undefined);
});

test("ignores an email-like mention that is not a path", async () => {
	const dir = await fixtureDir({});
	assert.equal(await attachLocalMedia("mail me at someone@example.com", dir), undefined);
});

test("splits text around markers", () => {
	const marker = makeMarker("/tmp/a.mp3", "audio/mpeg");
	assert.deepEqual(splitMarkers(`look\n\n${marker}\nthanks`), [
		{ type: "text", text: "look" },
		{ type: "media", path: "/tmp/a.mp3", mediaType: "audio/mpeg" },
		{ type: "text", text: "thanks" },
	]);
	assert.deepEqual(splitMarkers("no media here"), [{ type: "text", text: "no media here" }]);
});
