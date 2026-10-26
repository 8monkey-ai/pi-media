import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { findLocalMedia } from "../src/media.ts";

// PNG signature and IHDR chunk of a 1x1 image.
export const PNG_BYTES = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
	0x1f, 0x15, 0xc4, 0x89,
]);

// MPEG-1 Layer III frame header.
export const MP3_BYTES = Buffer.from([0xff, 0xfb, 0x90, 0x44, 0, 0, 0, 0]);

export const WAV_BYTES = Buffer.concat([Buffer.from("RIFF"), Buffer.from([36, 0, 0, 0]), Buffer.from("WAVEfmt ")]);

export const MP4_BYTES = Buffer.concat([
	Buffer.from([0, 0, 0, 0x18]),
	Buffer.from("ftypmp42"),
	Buffer.alloc(4),
	Buffer.from("mp42isom"),
]);

export const MOV_BYTES = Buffer.concat([
	Buffer.from([0, 0, 0, 0x14]),
	Buffer.from("ftypqt  "),
	Buffer.alloc(4),
	Buffer.from("qt  "),
]);

function pngChunk(type: string, data: Buffer) {
	const typed = Buffer.concat([Buffer.from(type), data]);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(typed));
	return Buffer.concat([length, typed, crc]);
}

// A grayscale PNG one row high, wider than the 2000 pixels pi resizes to by default.
export function widePng(width: number) {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(1, 4);
	header[8] = 8;
	return Buffer.concat([
		PNG_BYTES.subarray(0, 8),
		pngChunk("IHDR", header),
		pngChunk("IDAT", deflateSync(Buffer.alloc(width + 1))),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}

// The image content that pi gets for PNG_BYTES.
export const PNG_IMAGE = { type: "image", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ", mimeType: "image/png" };

// The Chat Completions part that carries MP3_BYTES.
export const MP3_PART = { type: "input_audio", input_audio: { data: "//uQRAAAAAA=", format: "mp3" } };

export const AUDIO_MODEL = { provider: "hebo", id: "gpt-transcribe", api: "openai-transcriptions" };
export const CHAT_MODEL = { provider: "hebo", id: "gpt-4.1-mini", api: "openai-completions" };

export async function fixtureDir(files: Record<string, string | Buffer>) {
	const dir = await mkdtemp(join(tmpdir(), "pi-media-"));
	for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
	return dir;
}

export function findMedia(text: string, cwd: string) {
	return findLocalMedia(text, cwd, 20971520);
}
