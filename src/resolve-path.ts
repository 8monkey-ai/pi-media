import { access } from "node:fs/promises";
import { createReadTool } from "@earendil-works/pi-coding-agent";

// Pi's read tool resolves the path and then calls `access` before it reads anything,
// so `access` records the path if it exists and stops the read.
export async function resolveLikePiRead(path: string, cwd: string) {
	let existing: string | undefined;
	const stopAt = async (candidate: string): Promise<never> => {
		await access(candidate);
		existing = candidate;
		throw new Error("pi-media uses only the resolved path");
	};
	await createReadTool(cwd, { operations: { access: stopAt, readFile: stopAt } })
		.execute("", { path })
		.catch(() => undefined);
	return existing;
}
