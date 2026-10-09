import assert from "node:assert/strict";
import { test } from "node:test";
import { findAdapter, registerAdapter } from "../src/adapters/registry.ts";

function testAdapter(api: string, provider?: string) {
	return { api, provider, carries: () => true, rewrite: () => undefined };
}

test("picks the adapter for the provider before the adapter for the API alone", () => {
	const general = testAdapter("test-registry-a");
	const special = testAdapter("test-registry-a", "special");
	registerAdapter(general);
	registerAdapter(special);
	assert.equal(findAdapter({ api: "test-registry-a", provider: "special" }), special);
	assert.equal(findAdapter({ api: "test-registry-a", provider: "other" }), general);
});

test("applies a provider adapter only to its provider", () => {
	registerAdapter(testAdapter("test-registry-b", "special"));
	assert.equal(findAdapter({ api: "test-registry-b", provider: "other" }), undefined);
});

test("finds no adapter for an unknown API or without a model", () => {
	assert.equal(findAdapter({ api: "test-registry-unknown", provider: "any" }), undefined);
	assert.equal(findAdapter(undefined), undefined);
});
