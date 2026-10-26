import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import type { MessageRenderer, Theme } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import extension from "../src/index.ts";
import { startSession } from "./session-harness.ts";

// Pi's terminal UI adds its own key bindings, such as the one that expands tool output, to the TUI bindings.
setKeybindings(new KeybindingsManager({ ...TUI_KEYBINDINGS, "app.tools.expand": { defaultKeys: "ctrl+o" } }));

const plainTheme = { fg: (_color: string, text: string) => text } as Theme;

const { session } = await startSession([extension]);
const renderer = session.extensionRunner.getMessageRenderer("pi-media-text") as MessageRenderer<{ error: boolean }> | undefined;
assert.ok(renderer);

const render = (content: string, error: boolean, expanded: boolean) => {
	const message = {
		role: "custom",
		customType: "pi-media-text",
		content,
		display: true,
		details: { error },
		timestamp: 1,
	} as const;
	const component = renderer(message, { expanded, outputPad: 1 }, plainTheme);
	assert.ok(component);
	return component.render(50).map((line) => stripVTControlCharacters(line).trimEnd());
};

const transcript = "Transcript of call.m4a · hebo/gpt-transcribe\n\nOK, let's start.\nFirst point is the Q3 release.\nMarco?";

test("shows the first line of a transcript and the number of hidden lines while collapsed", async () => {
	assert.deepEqual(render(transcript, false, false), [
		" ▸ Transcript of call.m4a · hebo/gpt-transcribe",
		"   OK, let's start.",
		"   … (2 more lines, ctrl+o to expand)",
	]);
});

test("shows all of a transcript while expanded", async () => {
	assert.deepEqual(render(transcript, false, true), [
		" ▾ Transcript of call.m4a · hebo/gpt-transcribe",
		"   OK, let's start.",
		"   First point is the Q3 release.",
		"   Marco?",
		"   (ctrl+o to collapse)",
	]);
});

test("shows no hint for a text of one line", async () => {
	assert.deepEqual(render("Description of a.png · hebo/gpt-4.1-mini\n\nA cat.", false, false), [
		" ▸ Description of a.png · hebo/gpt-4.1-mini",
		"   A cat.",
	]);
});

test("shows all of an error note at the indent of a text", async () => {
	const note = "pi-media: hebo/gpt-transcribe could not transcribe call.m4a: 413 File too large.";
	assert.deepEqual(render(note, true, false), [
		" ✗ pi-media: hebo/gpt-transcribe could not",
		"   transcribe call.m4a: 413 File too large.",
	]);
});
