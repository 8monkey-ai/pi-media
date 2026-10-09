import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { findPathCandidates } from "../src/find-paths.ts";
import { findLocalMedia } from "../src/media.ts";
import { resolveExistingPath, resolvePath } from "../src/resolve-path.ts";
import { fixtureDir, MP3_BYTES, PNG_BYTES, PNG_IMAGE } from "./fixtures.ts";

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

function findMedia(text: string, cwd: string) {
	return findLocalMedia(text, cwd, 20971520);
}

function only(...attachments: unknown[]) {
	return { images: [], attachments };
}

test("attaches a bare absolute image path", async () => {
	assert.deepEqual(await findMedia(`${dir}/shot.png what is this?`, "/"), {
		images: [PNG_IMAGE],
		attachments: [],
	});
});

test("attaches a path with backslash escapes", async () => {
	assert.deepEqual(await findMedia(`see ${dir}/My\\ File.pdf now`, "/"), only(myFile));
});

test("attaches a single-quoted path, including a quote written as '\\''", async () => {
	assert.deepEqual(await findMedia(`see '${dir}/My File.pdf' now`, "/"), only(myFile));
	assert.deepEqual(await findMedia(`'${dir}/it'\\''s.pdf'`, "/"), only(pdf("it's.pdf")));
});

test("attaches a double-quoted path", async () => {
	assert.deepEqual(await findMedia(`see "${dir}/My File.pdf" now`, "/"), only(myFile));
});

test("attaches a percent-encoded file URI", async () => {
	assert.deepEqual(await findMedia(`see file://${dir}/My%20File.pdf now`, "/"), only(myFile));
});

test("attaches several paths on separate lines and separated by spaces", async () => {
	assert.deepEqual(await findMedia(`${dir}/shot.png\n${dir}/My\\ File.pdf\n'${dir}/clip.mp3'`, "/"), {
		images: [PNG_IMAGE],
		attachments: [myFile, clip],
	});
	assert.deepEqual(await findMedia(`${dir}/report.pdf ${dir}/clip.mp3 `, "/"), only(report, clip));
});

test("attaches pasted paths with spaces, one per line, without quotes or backslashes", async () => {
	assert.deepEqual(await findMedia(`${dir}/My Shot.png\n${dir}/My File.pdf`, "/"), {
		images: [PNG_IMAGE],
		attachments: [myFile],
	});
	assert.deepEqual(await findMedia(`  @${dir}/My File.pdf \nwhat is this?`, "/"), only(myFile));
});

test("finds a path with spaces only when it fills the whole line", async () => {
	assert.deepEqual(await findMedia(`see ${dir}/My File.pdf`, "/"), NOTHING);
	assert.deepEqual(await findMedia(`${dir}/report.pdf and more`, "/"), only(report));
});

test("resolves ./ and ../ against the working directory", async () => {
	assert.deepEqual(await findMedia("see ./report.pdf", dir), only(report));
	assert.deepEqual(await findMedia("see ../report.pdf", join(dir, "sub")), only(report));
});

test("resolves ~/ against the home directory", async (t) => {
	const home = process.env.HOME;
	t.after(() => {
		process.env.HOME = home;
	});
	process.env.HOME = dir;
	assert.deepEqual(await findMedia("see ~/report.pdf", "/"), only(report));
});

test("keeps trailing punctuation and brackets outside a bare path", async () => {
	assert.deepEqual(await findMedia(`what is ${dir}/report.pdf?`, "/"), only(report));
	assert.deepEqual(await findMedia(`see (${dir}/report.pdf), ['${dir}/clip.mp3'].`, "/"), only(report, clip));
});

test("resolves a path with a leading @ to the path without it", async () => {
	assert.equal(await resolveExistingPath("@report.pdf", dir), join(dir, "report.pdf"));
	assert.equal(await resolveExistingPath(`@${dir}/report.pdf`, "/"), join(dir, "report.pdf"));
});

test("finds a macOS screenshot with a narrow no-break space before AM", async () => {
	const screenshot = pdf("Screenshot 2024-01-01 at 10.00.00\u202FAM.pdf");
	assert.deepEqual(await findMedia(`'${dir}/Screenshot 2024-01-01 at 10.00.00 AM.pdf'`, "/"), only(screenshot));
	assert.deepEqual(await findMedia(`${dir}/Screenshot\\ 2024-01-01\\ at\\ 10.00.00\u202FAM.pdf`, "/"), only(screenshot));
});

test("finds decomposed and curly-quote file names typed in composed form with a straight quote", async () => {
	const image = { images: [PNG_IMAGE], attachments: [] };
	assert.deepEqual(await findMedia(`${dir}/Caf\u00e9.png`, "/"), image);
	assert.deepEqual(await findMedia(`${dir}/don\\'t.png`, "/"), image);
	assert.deepEqual(await findMedia(`${dir}/Capture\\ d\\'\u00e9cran.png`, "/"), image);
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
		assert.deepEqual(await findMedia(text, "/"), NOTHING);
	}
});

test("finds Windows drive, UNC, relative and home paths only on Windows", () => {
	const cases = [
		{ text: String.raw`see C:\Users\me\a.pdf now`, windows: [{ start: 4, end: 21, path: String.raw`C:\Users\me\a.pdf` }] },
		{ text: "see C:/Users/me/a.pdf now", windows: [{ start: 4, end: 21, path: "C:/Users/me/a.pdf" }] },
		{ text: String.raw`see \\server\share\a.pdf now`, windows: [{ start: 4, end: 24, path: String.raw`\\server\share\a.pdf` }] },
		{ text: String.raw`see .\a.pdf now`, windows: [{ start: 4, end: 11, path: String.raw`.\a.pdf` }] },
		{ text: String.raw`see ..\a.pdf now`, windows: [{ start: 4, end: 12, path: String.raw`..\a.pdf` }] },
		{ text: String.raw`see ~\a.pdf now`, windows: [{ start: 4, end: 11, path: String.raw`~\a.pdf` }] },
	];
	for (const { text, windows } of cases) {
		assert.deepEqual(findPathCandidates(text, "win32"), windows, text);
		assert.deepEqual(findPathCandidates(text, "darwin"), [], text);
		assert.deepEqual(findPathCandidates(text, "linux"), [], text);
	}
});

test("reads a backslash as a path character on Windows and as an escape elsewhere", () => {
	const mention = String.raw`see @docs\notes.pdf now`;
	assert.deepEqual(findPathCandidates(mention, "win32"), [{ start: 4, end: 19, path: String.raw`docs\notes.pdf` }]);
	assert.deepEqual(findPathCandidates(mention, "darwin"), [{ start: 4, end: 19, path: "docsnotes.pdf" }]);
	const escaped = String.raw`see /a/My\ File.pdf now`;
	assert.deepEqual(findPathCandidates(escaped, "win32"), [{ start: 4, end: 10, path: "/a/My\\" }]);
	assert.deepEqual(findPathCandidates(escaped, "darwin"), [{ start: 4, end: 19, path: "/a/My File.pdf" }]);
});

test("groups a quoted Windows path with spaces", () => {
	const double = String.raw`see "C:\Users\me\My File.pdf" now`;
	assert.deepEqual(findPathCandidates(double, "win32"), [{ start: 4, end: 29, path: String.raw`C:\Users\me\My File.pdf` }]);
	assert.deepEqual(findPathCandidates(double, "darwin"), []);
	const powershell = String.raw`& 'C:\Users\me\My File.pdf'`;
	assert.deepEqual(findPathCandidates(powershell, "win32"), [{ start: 2, end: 27, path: String.raw`C:\Users\me\My File.pdf` }]);
	assert.deepEqual(findPathCandidates(powershell, "darwin"), []);
});

test("reads '' and '\\'' as one apostrophe in single quotes on Windows", () => {
	assert.deepEqual(findPathCandidates(String.raw`& 'C:\Users\me\it''s.pdf'`, "win32"), [
		{ start: 2, end: 25, path: String.raw`C:\Users\me\it's.pdf` },
	]);
	assert.deepEqual(findPathCandidates(String.raw`see 'C:\Users\me\it'\''s.pdf' now`, "win32"), [
		{ start: 4, end: 29, path: String.raw`C:\Users\me\it's.pdf` },
	]);
});

test("finds a pasted image path in the temporary directory, also inside a word", () => {
	const uuid = "0b9f7c1e-5d2a-4c3b-9e8f-1a2b3c4d5e6f";
	assert.deepEqual(
		findPathCandidates(
			`seeC:\\Users\\Jane Doe\\AppData\\Local\\Temp\\pi-clipboard-${uuid}.png please`,
			"win32",
			String.raw`C:\Users\Jane Doe\AppData\Local\Temp`,
		),
		[{ start: 3, end: 93, path: `C:\\Users\\Jane Doe\\AppData\\Local\\Temp\\pi-clipboard-${uuid}.png` }],
	);
	assert.deepEqual(findPathCandidates(`see/var/folders/x y/T/pi-clipboard-${uuid}.png please`, "darwin", "/var/folders/x y/T"), [
		{ start: 3, end: 75, path: `/var/folders/x y/T/pi-clipboard-${uuid}.png` },
	]);
	assert.deepEqual(findPathCandidates(`see/other/pi-clipboard-${uuid}.png`, "darwin", "/var/folders/x y/T"), []);
	assert.deepEqual(findPathCandidates(`C:\\pi-clipboard-${uuid}.gif`, "win32", "C:\\").slice(0, 1), [
		{ start: 0, end: 56, path: `C:\\pi-clipboard-${uuid}.gif` },
	]);
});

test("finds pasted Windows paths with spaces, one per line", () => {
	const text = [String.raw`C:\Users\me\My Shot.png`, String.raw`C:\Users\me\My File.pdf`].join("\r\n");
	assert.deepEqual(findPathCandidates(text, "win32"), [
		{ start: 0, end: 23, path: String.raw`C:\Users\me\My Shot.png` },
		{ start: 0, end: 14, path: String.raw`C:\Users\me\My` },
		{ start: 25, end: 48, path: String.raw`C:\Users\me\My File.pdf` },
		{ start: 25, end: 39, path: String.raw`C:\Users\me\My` },
	]);
	assert.deepEqual(findPathCandidates(text, "darwin"), []);
});

test("keeps trailing punctuation outside a Windows path and skips URLs", () => {
	assert.deepEqual(findPathCandidates(String.raw`what is C:\a.pdf?`, "win32"), [
		{ start: 8, end: 16, path: String.raw`C:\a.pdf` },
	]);
	assert.deepEqual(findPathCandidates(String.raw`see ("C:\My File.pdf").`, "win32"), [
		{ start: 5, end: 21, path: String.raw`C:\My File.pdf` },
	]);
	for (const platform of ["win32", "darwin"] as const) {
		assert.deepEqual(findPathCandidates("see https://example.com/C:/a.pdf now", platform), []);
	}
});

test("resolves Windows paths by pi's Windows rules", (t) => {
	const home = process.env.HOME;
	t.after(() => {
		process.env.HOME = home;
	});
	process.env.HOME = String.raw`C:\Users\me`;
	const cwd = String.raw`C:\work`;
	const cases = [
		[String.raw`C:\Users\me\a.pdf`, String.raw`C:\Users\me\a.pdf`],
		["C:/Users/me/a.pdf", String.raw`C:\Users\me\a.pdf`],
		[String.raw`\\server\share\a.pdf`, String.raw`\\server\share\a.pdf`],
		[String.raw`.\a.pdf`, String.raw`C:\work\a.pdf`],
		[String.raw`..\a.pdf`, String.raw`C:\a.pdf`],
		[String.raw`@docs\notes.pdf`, String.raw`C:\work\docs\notes.pdf`],
		[String.raw`~\a.pdf`, String.raw`C:\Users\me\a.pdf`],
		["~/a.pdf", String.raw`C:\Users\me\a.pdf`],
		["/c/Users/me/a.pdf", String.raw`C:\Users\me\a.pdf`],
		["/mnt/d/My Files/a.pdf", String.raw`D:\My Files\a.pdf`],
		["/cygdrive/e/a.pdf", String.raw`E:\a.pdf`],
		["file:///C:/Users/me/My%20File.pdf", String.raw`C:\Users\me\My File.pdf`],
	];
	for (const [path, expected] of cases) assert.equal(resolvePath(path, cwd, "win32"), expected, path);
	assert.equal(resolvePath("a.pdf", "/c/work", "win32"), String.raw`C:\work\a.pdf`);
});

test("keeps Windows-only rules off on macOS and Linux", (t) => {
	const home = process.env.HOME;
	t.after(() => {
		process.env.HOME = home;
	});
	process.env.HOME = "/home/me";
	assert.equal(resolvePath("/c/Users/me/a.pdf", "/work", "linux"), "/c/Users/me/a.pdf");
	assert.equal(resolvePath("/mnt/d/a.pdf", "/work", "linux"), "/mnt/d/a.pdf");
	assert.equal(resolvePath(String.raw`~\a.pdf`, "/work", "darwin"), String.raw`/work/~\a.pdf`);
	assert.equal(resolvePath("~/a.pdf", "/work", "darwin"), "/home/me/a.pdf");
});
