import type { Adapter } from "./adapter.ts";

const adapters: Adapter[] = [];

export function registerAdapter(adapter: Adapter) {
	adapters.push(adapter);
}

export function findAdapter(model: { api: string; provider: string } | undefined) {
	const forApi = adapters.filter((adapter) => adapter.api === model?.api);
	return (
		forApi.find((adapter) => adapter.provider === model?.provider) ?? forApi.find((adapter) => adapter.provider === undefined)
	);
}
