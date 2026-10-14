// Gives each message the first item after the last matched item that `matches` it, or undefined.
export function matchInOrder<M, T>(messages: M[], items: T[], matches: (message: M, item: T) => boolean) {
	let next = 0;
	return messages.map((message) => {
		for (let index = next; index < items.length; index++) {
			if (!matches(message, items[index])) continue;
			next = index + 1;
			return items[index];
		}
		return undefined;
	});
}
