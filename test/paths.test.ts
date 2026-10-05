import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { findLocalMedia } from "../src/media.ts";
import { resolveExistingPath } from "../src/resolve-path.ts";
import { fixtureDir, MP3_BYTES, PNG_BYTES } from "./fixtures.ts";

const PNG_IMAGE = { type: "image", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ", mimeType: "image/png" };

const dir = await fixtureDir({
	"shot.png": PNG_BYTES,
	"My Shot.png": PNG_BYTES,
	"My File.pdf": "%PDF-1.4",
	"it's.pdf": "%PDF-1.4",
	"report.pdf": "%PDF-1.4",
	"clip.mp3": MP3_BYTES,
	"empty.pdf": "",
	"notes.md": "# hi",
	"Screenshot 2024-01-01 at 10.00.00\u202FAM.pdf": "%PDF-1.4",
	"Cafe\u0301.png": PNG_BYTES,
	"Capture d\u2019e\u0301cran.png": PNG_BYTES,
	"don\u2019t.png": PNG_BYTES,
});
await mkdir(join(dir, "sub"));

const NOTHING = { images: [], attachments: [] };
const pdf = (name: string) => ({ path: join(dir, name), mimeType: "application/pdf", data: "JVBERi0xLjQ=" });
const myFile = pdf("My File.pdf");
const report = pdf("report.pdf");
const clip = { path: join(dir, "clip.mp3"), mimeType: "audio/mpeg", data: "//uQRAAAAAA=" };

function only(...attachments: unknown[]) {
	return { images: [], attachments };
}

test("attaches a bare absolute image path", async () => {
	assert.deepEqual(await findLocalMedia(`${dir}/shot.png what is this?`, "/"), { images: [PNG_IMAGE], attachments: [] });
});

test("attaches a path with backslash escapes", async () => {
	assert.deepEqual(await findLocalMedia(`see ${dir}/My\\ File.pdf now`, "/"), only(myFile));
});

test("attaches a single-quoted path, including a quote written as '\\''", async () => {
	assert.deepEqual(await findLocalMedia(`see '${dir}/My File.pdf' now`, "/"), only(myFile));
	assert.deepEqual(await findLocalMedia(`'${dir}/it'\\''s.pdf'`, "/"), only(pdf("it's.pdf")));
});

test("attaches a double-quoted path", async () => {
	assert.deepEqual(await findLocalMedia(`see "${dir}/My File.pdf" now`, "/"), only(myFile));
});

test("attaches a percent-encoded file URI", async () => {
	assert.deepEqual(await findLocalMedia(`see file://${dir}/My%20File.pdf now`, "/"), only(myFile));
});

test("attaches several paths on separate lines and separated by spaces", async () => {
	assert.deepEqual(await findLocalMedia(`${dir}/shot.png\n${dir}/My\\ File.pdf\n'${dir}/clip.mp3'`, "/"), {
		images: [PNG_IMAGE],
		attachments: [myFile, clip],
	});
	assert.deepEqual(await findLocalMedia(`${dir}/report.pdf ${dir}/clip.mp3 `, "/"), only(report, clip));
});

test("attaches pasted paths with spaces, one per line, without quotes or backslashes", async () => {
	assert.deepEqual(await findLocalMedia(`${dir}/My Shot.png\n${dir}/My File.pdf`, "/"), {
		images: [PNG_IMAGE],
		attachments: [myFile],
	});
	assert.deepEqual(await findLocalMedia(`  @${dir}/My File.pdf \nwhat is this?`, "/"), only(myFile));
});

test("finds a path with spaces only when it fills the whole line", async () => {
	assert.deepEqual(await findLocalMedia(`see ${dir}/My File.pdf`, "/"), NOTHING);
	assert.deepEqual(await findLocalMedia(`${dir}/report.pdf and more`, "/"), only(report));
});

test("resolves ./ and ../ against the working directory", async () => {
	assert.deepEqual(await findLocalMedia("see ./report.pdf", dir), only(report));
	assert.deepEqual(await findLocalMedia("see ../report.pdf", join(dir, "sub")), only(report));
});

test("resolves ~/ against the home directory", async (t) => {
	const home = process.env.HOME;
	t.after(() => {
		process.env.HOME = home;
	});
	process.env.HOME = dir;
	assert.deepEqual(await findLocalMedia("see ~/report.pdf", "/"), only(report));
});

test("keeps trailing punctuation and brackets outside a bare path", async () => {
	assert.deepEqual(await findLocalMedia(`what is ${dir}/report.pdf?`, "/"), only(report));
	assert.deepEqual(await findLocalMedia(`see (${dir}/report.pdf), ['${dir}/clip.mp3'].`, "/"), only(report, clip));
});

test("resolves a path with a leading @ to the path without it", async () => {
	assert.equal(await resolveExistingPath("@report.pdf", dir), join(dir, "report.pdf"));
	assert.equal(await resolveExistingPath(`@${dir}/report.pdf`, "/"), join(dir, "report.pdf"));
});

test("finds a macOS screenshot with a narrow no-break space before AM", async () => {
	const screenshot = pdf("Screenshot 2024-01-01 at 10.00.00\u202FAM.pdf");
	assert.deepEqual(await findLocalMedia(`'${dir}/Screenshot 2024-01-01 at 10.00.00 AM.pdf'`, "/"), only(screenshot));
	assert.deepEqual(await findLocalMedia(`${dir}/Screenshot\\ 2024-01-01\\ at\\ 10.00.00\u202FAM.pdf`, "/"), only(screenshot));
});

test("finds decomposed and curly-quote file names typed in composed form with a straight quote", async () => {
	const image = { images: [PNG_IMAGE], attachments: [] };
	assert.deepEqual(await findLocalMedia(`${dir}/Caf\u00e9.png`, "/"), image);
	assert.deepEqual(await findLocalMedia(`${dir}/don\\'t.png`, "/"), image);
	assert.deepEqual(await findLocalMedia(`${dir}/Capture\\ d\\'\u00e9cran.png`, "/"), image);
});

test("leaves paths that are missing, directories, empty, unsupported or inside a word or URL as text", async () => {
	for (const text of [
		`${dir}/absent.pdf`,
		`${dir}/sub`,
		`${dir}/empty.pdf`,
		`${dir}/notes.md`,
		`https://localhost${dir}/report.pdf`,
		`x${dir}/report.pdf`,
		`'${dir}/report.pdf`,
	]) {
		assert.deepEqual(await findLocalMedia(text, "/"), NOTHING);
	}
});
