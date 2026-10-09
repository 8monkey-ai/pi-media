const MARKER_RE = /^\[\[pi-media:([^:\]]+):(\d+)\]\]$/;

export function makeMarker(entryId: string, index: number) {
	return `[[pi-media:${entryId}:${index}]]`;
}

function parseMarker(text: string) {
	const match = MARKER_RE.exec(text);
	return match ? { entryId: match[1], index: Number(match[2]) } : undefined;
}

// The context hook adds each marker as the last text blocks of a message, one block for each marker. So a marker is
// the whole text of a block, or, where pi-ai joins the text blocks into one string with "\n" (`joined`), one of the
// last lines of that string that are each one whole marker. Text that only contains a marker, for example the output
// of a tool, stays as it is.
// Returns the text without its markers, and the markers, or undefined when the text has no marker.
export function takeMarkers(text: string, joined: boolean) {
	if (!joined) {
		const marker = parseMarker(text);
		return marker && { text: "", markers: [marker] };
	}
	const lines = text.split("\n");
	const markers = [];
	let start = lines.length;
	while (start > 0) {
		const marker = parseMarker(lines[start - 1]);
		if (!marker) break;
		markers.unshift(marker);
		start--;
	}
	if (start === lines.length) return undefined;
	return { text: lines.slice(0, start).join("\n"), markers };
}
