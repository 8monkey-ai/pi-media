import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// PNG signature and IHDR chunk of a 1x1 image.
export const PNG_BYTES = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
	0x1f, 0x15, 0xc4, 0x89,
]);

export async function fixtureDir(files: Record<string, string | Buffer>) {
	const dir = await mkdtemp(join(tmpdir(), "pi-media-"));
	for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
	return dir;
}
