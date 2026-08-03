import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { attachLocalMedia } from "./media.ts";
import { rewritePayload } from "./rewrite.ts";

export default function (pi: ExtensionAPI) {
	pi.on("before_provider_request", (event) => rewritePayload(event.payload));

	pi.on("input", async (event, ctx) => {
		const text = await attachLocalMedia(event.text, ctx.cwd);
		return text === undefined ? { action: "continue" } : { action: "transform", text };
	});
}
