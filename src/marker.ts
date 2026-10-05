const MARKER_RE = /\[\[pi-media:([^:\]]+):(\d+)\]\]/g;

export function makeMarker(entryId: string, index: number) {
	return `[[pi-media:${entryId}:${index}]]`;
}

type MarkerSegment = { type: "text"; text: string } | { type: "media"; entryId: string; index: number };

export function splitMarkers(text: string): MarkerSegment[] {
	const segments: MarkerSegment[] = [];
	let last = 0;
	for (const match of text.matchAll(MARKER_RE)) {
		const before = text.slice(last, match.index).trim();
		if (before) segments.push({ type: "text", text: before });
		segments.push({ type: "media", entryId: match[1], index: Number(match[2]) });
		last = match.index + match[0].length;
	}
	const after = text.slice(last).trim();
	if (after) segments.push({ type: "text", text: after });
	return segments;
}
