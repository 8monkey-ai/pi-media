import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { detectMediaType, makeSentinel, parseArgs } from "./media.ts";
import { rewritePayload } from "./rewrite.ts";

export default function (pi: ExtensionAPI) {
	pi.on("before_provider_request", async (event) => rewritePayload(event.payload));

	pi.registerCommand("media", {
		description: "Send a media URL (image, audio, document…) to the model as an attachment",
		handler: async (args, ctx) => {
			const parsed = parseArgs(args);
			if (!parsed) {
				if (ctx.hasUI) ctx.ui.notify("Usage: /media <url> [prompt]", "warning");
				return;
			}
			const mediaType = await detectMediaType(parsed.url);
			const sentinel = makeSentinel(parsed.url, mediaType);
			pi.sendUserMessage(parsed.prompt ? `${parsed.prompt}\n\n${sentinel}` : sentinel);
		},
	});
}
