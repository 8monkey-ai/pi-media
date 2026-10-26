import { keyText, type MessageRenderer, truncateToVisualLines } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

export const TEXT_TYPE = "pi-media-text";

function hintText(expanded: boolean, hiddenLines: number, key: string) {
	if (expanded) return `(${key} to collapse)`;
	return hiddenLines > 0 ? `… (${hiddenLines} more lines, ${key} to expand)` : undefined;
}

// A text is a heading, an empty line and the text. It shows its heading at the output indent and its lines two columns
// in. An error note has the same layout, with the mark in place of a heading.
export const renderMediaText: MessageRenderer<{ error: boolean }> = (message, { expanded, outputPad }, theme) => {
	const content = typeof message.content === "string" ? message.content : "";
	const pad = " ".repeat(outputPad);
	const block = (text: string, maxLines: number, width: number) =>
		truncateToVisualLines(text, maxLines, width, outputPad + 2, "start");
	const render = (width: number) => {
		if (message.details?.error) {
			const [first, ...rest] = block(theme.fg("error", content), Number.POSITIVE_INFINITY, width).visualLines;
			return [`${pad}${theme.fg("error", "✗")} ${first.trimStart()}`, ...rest];
		}
		const [heading, , ...lines] = content.split("\n");
		const head = truncateToWidth(theme.fg("customMessageLabel", `${expanded ? "▾" : "▸"} ${heading}`), width - outputPad * 2);
		const body = block(lines.join("\n"), expanded ? Number.POSITIVE_INFINITY : 1, width);
		const hint = hintText(expanded, body.skippedCount, keyText("app.tools.expand"));
		const hintLines = hint === undefined ? [] : block(theme.fg("dim", hint), 1, width).visualLines;
		return [`${pad}${head}`, ...body.visualLines, ...hintLines];
	};
	return { render, invalidate: () => {} };
};
