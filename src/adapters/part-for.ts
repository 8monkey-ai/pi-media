import type { Attachment } from "../media-entry.ts";
import type { Place } from "./adapter.ts";

export type Build = (attachment: Attachment) => unknown;
// Returns the builder of the part that carries a file of this type in this place, or undefined when the API cannot carry
// the file there. Each adapter decides this in one function, and `carries` and the rewrite both follow it.
export type PartFor = (mimeType: string, place: Place) => Build | undefined;

export function carriesBy(partFor: (mimeType: string, place: Place) => unknown) {
	return (mimeType: string, place: Place) => partFor(mimeType, place) !== undefined;
}

export function builderIn(partFor: PartFor, place: Place): Build {
	return (attachment) => partFor(attachment.mimeType, place)?.(attachment);
}
