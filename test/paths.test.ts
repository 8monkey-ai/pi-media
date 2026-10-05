import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { attachLocalMedia, makeMarker } from "../src/media.ts";
import { fixtureDir, PNG_BYTES } from "./fixtures.ts";

const PNG_IMAGE = { type: "image", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ", mimeType: "image/png" };

const dir = await fixtureDir({
	"shot.png": PNG_BYTES,
	"My Shot.png": PNG_BYTES,
	"My File.pdf": "%PDF-1.4",
	"it's.pdf": "%PDF-1.4",
	"report.pdf": "%PDF-1.4",
	"clip.mp3": "mp3",
	"empty.pdf": "",
	"notes.md": "# hi",
	"Screenshot 2024-01-01 at 10.00.00\u202FAM.pdf": "%PDF-1.4",
	"Cafe\u0301.png": PNG_BYTES,
	"Capture d\u2019e\u0301cran.png": PNG_BYTES,
	"don\u2019t.png": PNG_BYTES,
});
await mkdir(join(dir, "sub"));

const myFile = makeMarker(join(dir, "My File.pdf"), "application/pdf");
const report = makeMarker(join(dir, "report.pdf"), "application/pdf");
const clip = makeMarker(join(dir, "clip.mp3"), "audio/mpeg");

test("attaches a bare absolute image path and keeps the text as typed", async () => {
	assert.deepEqual(await attachLocalMedia(`${dir}/shot.png what is this?`, "/"), {
		text: `${dir}/shot.png what is this?`,
		images: [PNG_IMAGE],
	});
});

test("replaces a path with backslash escapes", async () => {
	assert.deepEqual(await attachLocalMedia(`see ${dir}/My\\ File.pdf now`, "/"), { text: `see ${myFile} now`, images: [] });
});

test("replaces a single-quoted path, including a quote written as '\\''", async () => {
	assert.deepEqual(await attachLocalMedia(`see '${dir}/My File.pdf' now`, "/"), { text: `see ${myFile} now`, images: [] });
	assert.deepEqual(await attachLocalMedia(`'${dir}/it'\\''s.pdf'`, "/"), {
		text: makeMarker(join(dir, "it's.pdf"), "application/pdf"),
		images: [],
	});
});

test("replaces a double-quoted path", async () => {
	assert.deepEqual(await attachLocalMedia(`see "${dir}/My File.pdf" now`, "/"), { text: `see ${myFile} now`, images: [] });
});

test("replaces a percent-encoded file URI", async () => {
	assert.deepEqual(await attachLocalMedia(`see file://${dir}/My%20File.pdf now`, "/"), { text: `see ${myFile} now`, images: [] });
});

test("attaches several paths on separate lines and separated by spaces", async () => {
	assert.deepEqual(await attachLocalMedia(`${dir}/shot.png\n${dir}/My\\ File.pdf\n'${dir}/clip.mp3'`, "/"), {
		text: `${dir}/shot.png\n${myFile}\n${clip}`,
		images: [PNG_IMAGE],
	});
	assert.deepEqual(await attachLocalMedia(`${dir}/report.pdf ${dir}/clip.mp3 `, "/"), { text: `${report} ${clip} `, images: [] });
});

test("attaches pasted paths with spaces, one per line, without quotes or backslashes", async () => {
	assert.deepEqual(await attachLocalMedia(`${dir}/My Shot.png\n${dir}/My File.pdf`, "/"), {
		text: `${dir}/My Shot.png\n${myFile}`,
		images: [PNG_IMAGE],
	});
	assert.deepEqual(await attachLocalMedia(`  @${dir}/My File.pdf \nwhat is this?`, "/"), {
		text: `  ${myFile} \nwhat is this?`,
		images: [],
	});
});

test("finds a path with spaces only when it fills the whole line", async () => {
	assert.equal(await attachLocalMedia(`see ${dir}/My File.pdf`, "/"), undefined);
	assert.deepEqual(await attachLocalMedia(`${dir}/report.pdf and more`, "/"), { text: `${report} and more`, images: [] });
});

test("resolves ./ and ../ against the working directory", async () => {
	assert.deepEqual(await attachLocalMedia("see ./report.pdf", dir), { text: `see ${report}`, images: [] });
	assert.deepEqual(await attachLocalMedia("see ../report.pdf", join(dir, "sub")), { text: `see ${report}`, images: [] });
});

test("resolves ~/ against the home directory", async (t) => {
	const home = process.env.HOME;
	t.after(() => {
		process.env.HOME = home;
	});
	process.env.HOME = dir;
	assert.deepEqual(await attachLocalMedia("see ~/report.pdf", "/"), { text: `see ${report}`, images: [] });
});

test("keeps trailing punctuation and brackets outside a bare path", async () => {
	assert.deepEqual(await attachLocalMedia(`what is ${dir}/report.pdf?`, "/"), { text: `what is ${report}?`, images: [] });
	assert.deepEqual(await attachLocalMedia(`see (${dir}/report.pdf), ['${dir}/clip.mp3'].`, "/"), {
		text: `see (${report}), [${clip}].`,
		images: [],
	});
});

test("finds a macOS screenshot with a narrow no-break space before AM", async () => {
	const marker = makeMarker(join(dir, "Screenshot 2024-01-01 at 10.00.00\u202FAM.pdf"), "application/pdf");
	assert.deepEqual(await attachLocalMedia(`'${dir}/Screenshot 2024-01-01 at 10.00.00 AM.pdf'`, "/"), {
		text: marker,
		images: [],
	});
	assert.deepEqual(await attachLocalMedia(`${dir}/Screenshot\\ 2024-01-01\\ at\\ 10.00.00\u202FAM.pdf`, "/"), {
		text: marker,
		images: [],
	});
});

test("finds decomposed and curly-quote file names typed in composed form with a straight quote", async () => {
	assert.deepEqual(await attachLocalMedia(`${dir}/Caf\u00e9.png`, "/"), { text: `${dir}/Caf\u00e9.png`, images: [PNG_IMAGE] });
	assert.deepEqual(await attachLocalMedia(`${dir}/don\\'t.png`, "/"), { text: `${dir}/don\\'t.png`, images: [PNG_IMAGE] });
	assert.deepEqual(await attachLocalMedia(`${dir}/Capture\\ d\\'\u00e9cran.png`, "/"), {
		text: `${dir}/Capture\\ d\\'\u00e9cran.png`,
		images: [PNG_IMAGE],
	});
});

test("leaves paths that are missing, directories, empty, unsupported or inside a word or URL as text", async () => {
	assert.equal(await attachLocalMedia(`${dir}/absent.pdf`, "/"), undefined);
	assert.equal(await attachLocalMedia(`${dir}/sub`, "/"), undefined);
	assert.equal(await attachLocalMedia(`${dir}/empty.pdf`, "/"), undefined);
	assert.equal(await attachLocalMedia(`${dir}/notes.md`, "/"), undefined);
	assert.equal(await attachLocalMedia(`https://localhost${dir}/report.pdf`, "/"), undefined);
	assert.equal(await attachLocalMedia(`x${dir}/report.pdf`, "/"), undefined);
	assert.equal(await attachLocalMedia(`'${dir}/report.pdf`, "/"), undefined);
});
