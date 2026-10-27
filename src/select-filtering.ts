import { DynamicBorder, type ExtensionContext, getSelectListTheme, keyHint, rawKeyHint } from "@earendil-works/pi-coding-agent";
import { Container, fuzzyFilter, Input, SelectList, Spacer, Text } from "@earendil-works/pi-tui";

const LIST_KEYS = ["tui.select.up", "tui.select.down", "tui.select.confirm", "tui.select.cancel"] as const;

// Filters the options as the user types, as pi's `/model` selector does.
// `custom` shows nothing outside the terminal UI, so other modes get `select`.
export function selectFiltering(ctx: ExtensionContext, title: string, options: string[], pinned: string) {
	if (ctx.mode !== "tui") return ctx.ui.select(title, [...options, pinned]);
	return ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
		const input = new Input();
		const listBox = new Container();
		let list: SelectList;
		const showMatches = () => {
			const rows = [...fuzzyFilter(options, input.getValue(), (row) => row), pinned];
			list = new SelectList(
				rows.map((row) => ({ value: row, label: row })),
				10,
				getSelectListTheme(),
			);
			list.onSelect = ({ value }) => done(value);
			list.onCancel = () => done(undefined);
			listBox.clear();
			listBox.addChild(list);
		};
		showMatches();
		const hints = `${rawKeyHint("↑↓", "navigate")}  ${keyHint("tui.select.confirm", "select")}  ${keyHint("tui.select.cancel", "cancel")}`;
		const frame = new Container();
		for (const child of [
			new DynamicBorder(),
			new Spacer(1),
			new Text(theme.fg("accent", theme.bold(title)), 1, 0),
			new Spacer(1),
			input,
			new Spacer(1),
			listBox,
			new Spacer(1),
			new Text(hints, 1, 0),
			new Spacer(1),
			new DynamicBorder(),
		]) {
			frame.addChild(child);
		}
		return {
			// The terminal UI sets `focused`, and the input shows the cursor only when it has focus.
			get focused() {
				return input.focused;
			},
			set focused(value) {
				input.focused = value;
			},
			render: (width) => frame.render(width),
			invalidate: () => frame.invalidate(),
			handleInput(data) {
				if (LIST_KEYS.some((key) => keybindings.matches(data, key))) list.handleInput(data);
				else {
					const before = input.getValue();
					input.handleInput(data);
					if (input.getValue() !== before) showMatches();
				}
				tui.requestRender();
			},
		};
	});
}
