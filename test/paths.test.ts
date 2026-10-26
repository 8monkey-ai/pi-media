import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { findPathCandidates } from "../src/find-paths.ts";
import { findMedia, fixtureDir, MP3_BYTES, PNG_BYTES, PNG_DATA } from "./fixtures.ts";

const dir = await fixtureDir({
	"shot.png": PNG_BYTES,
	"My Shot.png": PNG_BYTES,
	"My File.pdf": "%PDF-1.4",
	"it's.pdf": "%PDF-1.4",
	"report.pdf": "%PDF-1.4",
	"clip.mp3": MP3_BYTES,
	"clip.mp3 2.mp3": MP3_BYTES,
	'say "hi".pdf': "%PDF-1.4",
	"Screenshot 2024-01-01 at 10.00.00\u202FAM.pdf": "%PDF-1.4",
	"Cafe\u0301.png": PNG_BYTES,
	"Capture d\u2019e\u0301cran.png": PNG_BYTES,
	"don\u2019t.png": PNG_BYTES,
});
await mkdir(join(dir, "sub"));

const pdf = (name: string) => ({ path: join(dir, name), mimeType: "application/pdf", data: "JVBERi0xLjQ=" });
const png = (name: string) => ({ path: join(dir, name), mimeType: "image/png", data: PNG_DATA });
const myFile = pdf("My File.pdf");
const report = pdf("report.pdf");
const clip = { path: join(dir, "clip.mp3"), mimeType: "audio/mpeg", data: "//uQRAAAAAA=" };

// Sets the environment variables and returns a function that restores them. The restore deletes a variable that was not
// set, because process.env stores undefined as the string "undefined".
function setEnv(values: Record<string, string>) {
	const saved = Object.keys(values).map((name) => [name, process.env[name]] as const);
	Object.assign(process.env, values);
	return () => {
		for (const [name, value] of saved) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	};
}

// Sets the home directory until the test ends. os.homedir() reads HOME on macOS and Linux, and USERPROFILE on Windows.
function setHome(t: TestContext, home: string) {
	t.after(setEnv({ HOME: home, USERPROFILE: home }));
}

// Runs `run` with `process.platform` set to `platform` and os.tmpdir() returning `tempDir`.
// os.tmpdir() reads TMPDIR on macOS and Linux, and TEMP or TMP on Windows.
function onPlatform<T>(platform: NodeJS.Platform, run: () => T, tempDir = tmpdir()) {
	const original = Object.getOwnPropertyDescriptor(process, "platform");
	assert.ok(original);
	const restoreEnv = setEnv({ TMPDIR: tempDir, TEMP: tempDir, TMP: tempDir });
	Object.defineProperty(process, "platform", { ...original, value: platform });
	try {
		return run();
	} finally {
		Object.defineProperty(process, "platform", original);
		restoreEnv();
	}
}

const candidates = (text: string, platform: NodeJS.Platform, tempDir?: string) =>
	onPlatform(platform, () => findPathCandidates(text), tempDir);

test("attaches a bare absolute image path", async () => {
	assert.deepEqual(await findMedia(`${dir}/shot.png what is this?`, "/"), [png("shot.png")]);
});

test("attaches a path with backslash escapes", async () => {
	assert.deepEqual(await findMedia(`see ${dir}/My\\ File.pdf now`, "/"), [myFile]);
});

test("attaches a single-quoted path, including a quote written as '\\''", async () => {
	assert.deepEqual(await findMedia(`see '${dir}/My File.pdf' now`, "/"), [myFile]);
	assert.deepEqual(await findMedia(`'${dir}/it'\\''s.pdf'`, "/"), [pdf("it's.pdf")]);
});

test("attaches a double-quoted path, including escaped quotes in it", async () => {
	assert.deepEqual(await findMedia(`see "${dir}/My File.pdf" now`, "/"), [myFile]);
	assert.deepEqual(await findMedia(`"${dir}/say \\"hi\\".pdf"`, "/"), [pdf('say "hi".pdf')]);
});

test("attaches a percent-encoded file URI", async () => {
	assert.deepEqual(await findMedia(`see file://${dir}/My%20File.pdf now`, "/"), [myFile]);
});

test("attaches several paths on separate lines and separated by spaces", async () => {
	assert.deepEqual(await findMedia(`${dir}/shot.png\n${dir}/My\\ File.pdf\n'${dir}/clip.mp3'`, "/"), [
		png("shot.png"),
		myFile,
		clip,
	]);
	assert.deepEqual(await findMedia(`${dir}/report.pdf ${dir}/clip.mp3 `, "/"), [report, clip]);
});

test("attaches pasted paths with spaces, one per line, without quotes or backslashes", async () => {
	assert.deepEqual(await findMedia(`${dir}/My Shot.png\n${dir}/My File.pdf`, "/"), [png("My Shot.png"), myFile]);
	assert.deepEqual(await findMedia(`  @${dir}/My File.pdf \nwhat is this?`, "/"), [myFile]);
	assert.deepEqual(await findMedia(`see @clip.mp3\n${dir}/My File.pdf`, dir), [clip, myFile]);
});

test("attaches only the whole-line path when a shorter path at the same start also names a file", async () => {
	const clip2 = { path: join(dir, "clip.mp3 2.mp3"), mimeType: "audio/mpeg", data: "//uQRAAAAAA=" };
	assert.deepEqual(await findMedia(`${dir}/clip.mp3 2.mp3`, "/"), [clip2]);
});

test("finds a path with spaces only when it fills the whole line", async () => {
	assert.deepEqual(await findMedia(`see ${dir}/My File.pdf`, "/"), []);
	assert.deepEqual(await findMedia(`${dir}/report.pdf and more`, "/"), [report]);
});

test("resolves ./ and ../ against the working directory", async () => {
	assert.deepEqual(await findMedia("see ./report.pdf", dir), [report]);
	assert.deepEqual(await findMedia("see ../report.pdf", join(dir, "sub")), [report]);
});

test("resolves ~/ against the home directory", async (t) => {
	setHome(t, dir);
	assert.deepEqual(await findMedia("see ~/report.pdf", "/"), [report]);
});

test("keeps trailing punctuation and brackets outside a bare path", async () => {
	assert.deepEqual(await findMedia(`what is ${dir}/report.pdf?`, "/"), [report]);
	assert.deepEqual(await findMedia(`see (${dir}/report.pdf), ['${dir}/clip.mp3'].`, "/"), [report, clip]);
});

test("finds a macOS screenshot with a narrow no-break space before AM", async () => {
	const screenshot = pdf("Screenshot 2024-01-01 at 10.00.00\u202FAM.pdf");
	assert.deepEqual(await findMedia(`'${dir}/Screenshot 2024-01-01 at 10.00.00 AM.pdf'`, "/"), [screenshot]);
	assert.deepEqual(await findMedia(`${dir}/Screenshot\\ 2024-01-01\\ at\\ 10.00.00\u202FAM.pdf`, "/"), [screenshot]);
});

test("finds a file with a space where the typed path has a no-break space", async () => {
	assert.deepEqual(await findMedia(`${dir}/My\u00A0File.pdf`, "/"), [myFile]);
});

// The decomposed case can fail only on a file system that keeps NFC and NFD names apart, such as Linux, not on APFS.
// APFS finds the file under the composed name and Linux under the decomposed name, so the test compares composed paths.
test("finds decomposed and curly-quote file names typed in composed form with a straight quote", async () => {
	const findComposed = async (text: string) =>
		(await findMedia(text, "/")).map((file) => ({ ...file, path: file.path.normalize("NFC") }));
	assert.deepEqual(await findComposed(`${dir}/Caf\u00e9.png`), [png("Caf\u00e9.png")]);
	assert.deepEqual(await findComposed(`${dir}/don\\'t.png`), [png("don\u2019t.png")]);
	assert.deepEqual(await findComposed(`${dir}/Capture\\ d\\'\u00e9cran.png`), [png("Capture d\u2019\u00e9cran.png")]);
});

test("leaves directories, paths inside a word or URL, and file URIs with a host as text", async () => {
	for (const text of [
		`${dir}/sub`,
		`https://localhost${dir}/report.pdf`,
		`x${dir}/report.pdf`,
		`'${dir}/report.pdf`,
		"file://server/a.pdf",
	]) {
		assert.deepEqual(await findMedia(text, "/"), []);
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
		assert.deepEqual(candidates(text, "win32"), windows, text);
		assert.deepEqual(candidates(text, "darwin"), [], text);
		assert.deepEqual(candidates(text, "linux"), [], text);
	}
});

test("reads a backslash as a path character on Windows and as an escape elsewhere", () => {
	const mention = String.raw`see @docs\notes.pdf now`;
	assert.deepEqual(candidates(mention, "win32"), [{ start: 4, end: 19, path: String.raw`docs\notes.pdf` }]);
	assert.deepEqual(candidates(mention, "darwin"), [{ start: 4, end: 19, path: "docsnotes.pdf" }]);
	const escaped = String.raw`see /a/My\ File.pdf now`;
	assert.deepEqual(candidates(escaped, "win32"), [{ start: 4, end: 10, path: "/a/My\\" }]);
	assert.deepEqual(candidates(escaped, "darwin"), [{ start: 4, end: 19, path: "/a/My File.pdf" }]);
});

test("groups a quoted Windows path with spaces", () => {
	const double = String.raw`see "C:\Users\me\My File.pdf" now`;
	assert.deepEqual(candidates(double, "win32"), [{ start: 4, end: 29, path: String.raw`C:\Users\me\My File.pdf` }]);
	assert.deepEqual(candidates(double, "darwin"), []);
	const powershell = String.raw`& 'C:\Users\me\My File.pdf'`;
	assert.deepEqual(candidates(powershell, "win32"), [{ start: 2, end: 27, path: String.raw`C:\Users\me\My File.pdf` }]);
	assert.deepEqual(candidates(powershell, "darwin"), []);
});

test("finds a pasted image path in the temporary directory, also inside a word", () => {
	const uuid = "0b9f7c1e-5d2a-4c3b-9e8f-1a2b3c4d5e6f";
	assert.deepEqual(
		candidates(
			`seeC:\\Users\\Jane Doe\\AppData\\Local\\Temp\\pi-clipboard-${uuid}.png please`,
			"win32",
			String.raw`C:\Users\Jane Doe\AppData\Local\Temp`,
		),
		[{ start: 3, end: 93, path: `C:\\Users\\Jane Doe\\AppData\\Local\\Temp\\pi-clipboard-${uuid}.png` }],
	);
	assert.deepEqual(candidates(`see/var/folders/x y/T/pi-clipboard-${uuid}.png please`, "darwin", "/var/folders/x y/T"), [
		{ start: 3, end: 75, path: `/var/folders/x y/T/pi-clipboard-${uuid}.png` },
	]);
	assert.deepEqual(candidates(`see/other/pi-clipboard-${uuid}.png`, "darwin", "/var/folders/x y/T"), []);
	assert.deepEqual(candidates(`C:\\pi-clipboard-${uuid}.gif`, "win32", "C:\\").slice(0, 1), [
		{ start: 0, end: 56, path: `C:\\pi-clipboard-${uuid}.gif` },
	]);
});

// findLocalMedia keeps the first candidate at a start that names a file.
function firstAtEachStart(list: { start: number }[]) {
	return list.filter((candidate, index) => list.findIndex(({ start }) => start === candidate.start) === index);
}

test("finds pasted Windows paths with spaces, one per line", () => {
	const text = [String.raw`C:\Users\me\My Shot.png`, String.raw`C:\Users\me\My File.pdf`].join("\r\n");
	assert.deepEqual(firstAtEachStart(candidates(text, "win32")), [
		{ start: 0, end: 23, path: String.raw`C:\Users\me\My Shot.png` },
		{ start: 25, end: 48, path: String.raw`C:\Users\me\My File.pdf` },
	]);
	assert.deepEqual(candidates(text, "darwin"), []);
});

test("keeps trailing punctuation outside a Windows path and skips URLs", () => {
	assert.deepEqual(candidates(String.raw`what is C:\a.pdf?`, "win32"), [{ start: 8, end: 16, path: String.raw`C:\a.pdf` }]);
	assert.deepEqual(candidates(String.raw`see ("C:\My File.pdf").`, "win32"), [
		{ start: 5, end: 21, path: String.raw`C:\My File.pdf` },
	]);
	for (const platform of ["win32", "darwin"] as const) {
		assert.deepEqual(candidates("see https://example.com/C:/a.pdf now", platform), []);
	}
});
