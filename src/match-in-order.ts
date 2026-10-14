// Gives each message the first item after the last matched item that `matches` it, or undefined.
export function matchInOrder<M, T>(messages: M[], items: T[], matches: (message: M, item: T) => boolean) {
	let next = 0;
	return messages.map((message) => {
		const index = items.findIndex((item, position) => position >= next && matches(message, item));
		if (index === -1) return undefined;
		next = index + 1;
		return items[index];
	});
}
