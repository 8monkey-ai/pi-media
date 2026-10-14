import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionFactory,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

type SessionOptions = {
	files?: Record<string, string | Buffer>;
};

// Drives a real pi session with an in-memory session manager and pi-ai's faux provider. The model answers "ok".
// `files` go into the working directory, which is also the agent directory.
export async function startSession(extensions: ExtensionFactory[], { files = {} }: SessionOptions = {}) {
	const dir = await mkdtemp(join(tmpdir(), "pi-media-session-"));
	for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);

	const faux = fauxProvider();
	faux.setResponses(Array.from({ length: 50 }, () => fauxAssistantMessage("ok")));

	const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerNativeProvider(faux.provider);
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const resourceLoader = new DefaultResourceLoader({
		cwd: dir,
		agentDir: dir,
		settingsManager,
		extensionFactories: extensions,
		noContextFiles: true,
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd: dir,
		agentDir: dir,
		model: faux.getModel(),
		modelRuntime,
		resourceLoader,
		settingsManager,
		sessionManager: SessionManager.inMemory(dir),
		tools: [],
	});

	// Waits until `run` resolves and the session is idle.
	async function settle(run: Promise<unknown>) {
		await run;
		await session.waitForIdle();
	}

	return { session, settle };
}
