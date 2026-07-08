import assert from "node:assert/strict";
import { test } from "node:test";
import { autoAttachMedia, detectMediaType, hasSentinel, makeSentinel, mediaTypeFromExtension, parseArgs, splitTextWithSentinels } from "../src/media.ts";

test("parseArgs extracts url only", () => {
	assert.deepEqual(parseArgs("https://example.com/a.png"), { url: "https://example.com/a.png", prompt: "" });
});

test("parseArgs extracts url and prompt", () => {
	assert.deepEqual(parseArgs("  https://example.com/doc.md  what is this about?  "), {
		url: "https://example.com/doc.md",
		prompt: "what is this about?",
	});
});

test("parseArgs rejects empty and non-http input", () => {
	assert.equal(parseArgs(""), undefined);
	assert.equal(parseArgs("   "), undefined);
	assert.equal(parseArgs("ftp://example.com/a.png"), undefined);
	assert.equal(parseArgs("what is this?"), undefined);
});

test("mediaTypeFromExtension maps common extensions", () => {
	assert.equal(mediaTypeFromExtension("https://x.com/a.PNG"), "image/png");
	assert.equal(mediaTypeFromExtension("https://x.com/a.mp3?v=1"), "audio/mpeg");
	assert.equal(mediaTypeFromExtension("https://x.com/doc.md"), "text/markdown");
	assert.equal(mediaTypeFromExtension("https://x.com/doc.pdf"), "application/pdf");
	assert.equal(mediaTypeFromExtension("https://x.com/no-extension"), undefined);
});

test("detectMediaType falls back to HEAD content-type", async () => {
	const fetchStub = async () =>
		new Response(null, { headers: { "content-type": "text/markdown; charset=utf-8" } });
	assert.equal(await detectMediaType("https://x.com/page", fetchStub as typeof fetch), "text/markdown");
});

test("detectMediaType defaults to octet-stream when HEAD fails", async () => {
	const fetchStub = async () => {
		throw new Error("network down");
	};
	assert.equal(await detectMediaType("https://x.com/page", fetchStub as unknown as typeof fetch), "application/octet-stream");
});

test("sentinel roundtrip", () => {
	const s = makeSentinel("https://x.com/a.png", "image/png");
	assert.equal(s, "[[pi-media:https://x.com/a.png|image/png]]");
	assert.ok(hasSentinel(s));
	assert.ok(!hasSentinel("plain text"));
	assert.deepEqual(splitTextWithSentinels(s), [{ type: "file", data: "https://x.com/a.png", mediaType: "image/png" }]);
});

test("splitTextWithSentinels handles mixed text and multiple sentinels", () => {
	const text = `look at this\n\n${makeSentinel("https://x.com/a.png", "image/png")}\nand this ${makeSentinel("https://x.com/b.mp3", "audio/mpeg")} thanks`;
	assert.deepEqual(splitTextWithSentinels(text), [
		{ type: "text", text: "look at this" },
		{ type: "file", data: "https://x.com/a.png", mediaType: "image/png" },
		{ type: "text", text: "and this" },
		{ type: "file", data: "https://x.com/b.mp3", mediaType: "audio/mpeg" },
		{ type: "text", text: "thanks" },
	]);
});

test("splitTextWithSentinels keeps plain text intact", () => {
	assert.deepEqual(splitTextWithSentinels("no media here"), [{ type: "text", text: "no media here" }]);
});

test("autoAttachMedia wraps URLs with recognized media extensions", () => {
	assert.equal(
		autoAttachMedia("check https://x.com/a.png please"),
		"check [[pi-media:https://x.com/a.png|image/png]] please",
	);
});

test("autoAttachMedia wraps multiple media URLs", () => {
	assert.equal(
		autoAttachMedia("https://x.com/a.pdf and https://x.com/b.mp3"),
		"[[pi-media:https://x.com/a.pdf|application/pdf]] and [[pi-media:https://x.com/b.mp3|audio/mpeg]]",
	);
});

test("autoAttachMedia leaves non-media URLs and plain text alone", () => {
	assert.equal(autoAttachMedia("see https://github.com/foo/bar for context"), undefined);
	assert.equal(autoAttachMedia("no urls at all"), undefined);
	assert.equal(autoAttachMedia("https://x.com/page.html?q=1#frag is a page"), undefined);
});

test("autoAttachMedia does not double-wrap existing sentinels", () => {
	const already = "look at [[pi-media:https://x.com/a.png|image/png]]";
	assert.equal(autoAttachMedia(already), undefined);
});

test("autoAttachMedia excludes trailing punctuation from the URL", () => {
	assert.equal(
		autoAttachMedia("what is this (https://x.com/a.png)?"),
		"what is this ([[pi-media:https://x.com/a.png|image/png]])?",
	);
	assert.equal(autoAttachMedia("read https://x.com/doc.md."), "read [[pi-media:https://x.com/doc.md|text/markdown]].");
});

test("autoAttachMedia handles query strings on media URLs", () => {
	assert.equal(
		autoAttachMedia("https://cdn.x.com/a.mp3?token=abc"),
		"[[pi-media:https://cdn.x.com/a.mp3?token=abc|audio/mpeg]]",
	);
});
