import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Attachment } from "./media-entry.ts";

type MediaCall = {
	file: Attachment;
	provider: string;
	id: string;
	instruction: string;
	signal: AbortSignal | undefined;
};

// `name` is the `api` value of a media model setting. `read` sends the file to the model and gives back its text. It
// throws an error that gives the reason when the call fails.
export type MediaApi = {
	name: string;
	read: (call: MediaCall, registry: ExtensionContext["modelRegistry"]) => Promise<string>;
};
