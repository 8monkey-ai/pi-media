import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { findPathCandidates } from "../src/find-paths.ts";
import { resolvePath } from "../src/resolve-path.ts";
import { findMedia, fixtureDir, MP3_BYTES, NOTHING, PNG_BYTES, PNG_IMAGE } from "./fixtures.ts";

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
const myFile = pdf("My File.pdf");
const report = pdf("report.pdf");
const clip = { path: join(dir, "clip.mp3"), mimeType: "audio/mpeg", data: "//uQRAAAAAA=" };

function only(...attachments: unknown[]) {
	return { images: [], attachments };
}

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
const resolveOn = (platform: NodeJS.Platform, path: string, cwd: string) => onPlatform(platform, () => resolvePath(path, cwd));

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

test("attaches a double-quoted path, including escaped quotes in it", async () => {
	assert.deepEqual(await findMedia(`see "${dir}/My File.pdf" now`, "/"), only(myFile));
	assert.deepEqual(await findMedia(`"${dir}/say \\"hi\\".pdf"`, "/"), only(pdf('say "hi".pdf')));
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
	assert.deepEqual(await findMedia(`see @clip.mp3\n${dir}/My File.pdf`, dir), only(clip, myFile));
});

test("attaches only the whole-line path when a shorter path at the same start also names a file", async () => {
	const clip2 = { path: join(dir, "clip.mp3 2.mp3"), mimeType: "audio/mpeg", data: "//uQRAAAAAA=" };
	assert.deepEqual(await findMedia(`${dir}/clip.mp3 2.mp3`, "/"), only(clip2));
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
	setHome(t, dir);
	assert.deepEqual(await findMedia("see ~/report.pdf", "/"), only(report));
});

test("keeps trailing punctuation and brackets outside a bare path", async () => {
	assert.deepEqual(await findMedia(`what is ${dir}/report.pdf?`, "/"), only(report));
	assert.deepEqual(await findMedia(`see (${dir}/report.pdf), ['${dir}/clip.mp3'].`, "/"), only(report, clip));
});

test("finds a macOS screenshot with a narrow no-break space before AM", async () => {
	const screenshot = pdf("Screenshot 2024-01-01 at 10.00.00\u202FAM.pdf");
	assert.deepEqual(await findMedia(`'${dir}/Screenshot 2024-01-01 at 10.00.00 AM.pdf'`, "/"), only(screenshot));
	assert.deepEqual(await findMedia(`${dir}/Screenshot\\ 2024-01-01\\ at\\ 10.00.00\u202FAM.pdf`, "/"), only(screenshot));
});

test("finds a file with a space where the typed path has a no-break space", async () => {
	assert.deepEqual(await findMedia(`${dir}/My\u00A0File.pdf`, "/"), only(myFile));
});

// The decomposed case can fail only on a file system that keeps NFC and NFD names apart, such as Linux, not on APFS.
test("finds decomposed and curly-quote file names typed in composed form with a straight quote", async () => {
	const image = { images: [PNG_IMAGE], attachments: [] };
	assert.deepEqual(await findMedia(`${dir}/Caf\u00e9.png`, "/"), image);
	assert.deepEqual(await findMedia(`${dir}/don\\'t.png`, "/"), image);
	assert.deepEqual(await findMedia(`${dir}/Capture\\ d\\'\u00e9cran.png`, "/"), image);
});

test("leaves directories, paths inside a word or URL, and file URIs with a host as text", async () => {
	for (const text of [
		`${dir}/sub`,
		`https://localhost${dir}/report.pdf`,
		`x${dir}/report.pdf`,
		`'${dir}/report.pdf`,
		"file://server/a.pdf",
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

test("reads '' and '\\'' as one apostrophe in single quotes on Windows", () => {
	assert.deepEqual(candidates(String.raw`& 'C:\Users\me\it''s.pdf'`, "win32"), [
		{ start: 2, end: 25, path: String.raw`C:\Users\me\it's.pdf` },
	]);
	assert.deepEqual(candidates(String.raw`see 'C:\Users\me\it'\''s.pdf' now`, "win32"), [
		{ start: 4, end: 29, path: String.raw`C:\Users\me\it's.pdf` },
	]);
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

test("resolves Windows paths by pi's Windows rules", (t) => {
	setHome(t, String.raw`C:\Users\me`);
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
	for (const [path, expected] of cases) assert.equal(resolveOn("win32", path, cwd), expected, path);
	assert.equal(resolveOn("win32", "a.pdf", "/c/work"), String.raw`C:\work\a.pdf`);
});

test("keeps Windows-only rules off on macOS and Linux", (t) => {
	setHome(t, "/home/me");
	assert.equal(resolveOn("linux", "/c/Users/me/a.pdf", "/work"), "/c/Users/me/a.pdf");
	assert.equal(resolveOn("linux", "/mnt/d/a.pdf", "/work"), "/mnt/d/a.pdf");
	assert.equal(resolveOn("darwin", String.raw`~\a.pdf`, "/work"), String.raw`/work/~\a.pdf`);
	assert.equal(resolveOn("darwin", "~/a.pdf", "/work"), "/home/me/a.pdf");
});
