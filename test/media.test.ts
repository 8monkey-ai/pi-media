import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { attachLocalMedia, makeMarker, splitMarkers } from "../src/media.ts";

async function fixtureDir(files: Record<string, string>) {
	const dir = await mkdtemp(join(tmpdir(), "pi-media-"));
	for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
	return dir;
}

test("attaches an @-mentioned media file", async () => {
	const dir = await fixtureDir({ "report.pdf": "%PDF-1.4" });
	assert.equal(
		await attachLocalMedia("summarize @report.pdf please", dir),
		`summarize ${makeMarker(join(dir, "report.pdf"), "application/pdf")} please`,
	);
});

test("attaches quoted paths with spaces and multiple mentions", async () => {
	const dir = await fixtureDir({ "my shot.png": "png", "clip.mp3": "mp3" });
	assert.equal(
		await attachLocalMedia('@"my shot.png" and @clip.mp3', dir),
		`${makeMarker(join(dir, "my shot.png"), "image/png")} and ${makeMarker(join(dir, "clip.mp3"), "audio/mpeg")}`,
	);
});

test("keeps trailing punctuation outside the mention", async () => {
	const dir = await fixtureDir({ "invoice.pdf": "%PDF-1.4", "a.png": "png" });
	const marker = makeMarker(join(dir, "invoice.pdf"), "application/pdf");
	assert.equal(await attachLocalMedia("what is in @invoice.pdf?", dir), `what is in ${marker}?`);
	assert.equal(
		await attachLocalMedia("see (@a.png), then @invoice.pdf.", dir),
		`see (${makeMarker(join(dir, "a.png"), "image/png")}), then ${marker}.`,
	);
});

test("leaves files Gemini cannot take, unknown extensions, missing and empty files untouched", async () => {
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
	const marker = makeMarker("/tmp/a.png", "image/png");
	assert.deepEqual(splitMarkers(`look\n\n${marker}\nthanks`), [
		{ type: "text", text: "look" },
		{ type: "media", path: "/tmp/a.png", mediaType: "image/png" },
		{ type: "text", text: "thanks" },
	]);
	assert.deepEqual(splitMarkers("no media here"), [{ type: "text", text: "no media here" }]);
});
