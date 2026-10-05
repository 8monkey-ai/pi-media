import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FauxResponseFactory, fauxAssistantMessage, fauxProvider, type Message } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionFactory,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

type Request = { messages: Message[]; payload: unknown };

// The faux provider sends no payload of its own. This one has the Chat Completions shape of user messages,
// so that `before_provider_request` handlers run on every model call.
function userPayload(messages: Message[]) {
	return { messages: messages.filter((message) => message.role === "user").map(({ role, content }) => ({ role, content })) };
}

// Drives a real pi session with an in-memory session manager and pi-ai's faux provider.
// A model call waits until `settle` runs, so a test can queue input while pi streams.
// `files` go into the working directory. `sessionManager` defaults to an in-memory one.
// `api` is the API of the model. It defaults to Chat Completions, the shape of the payload.
export async function startSession(
	extensions: ExtensionFactory[],
	{
		files = {},
		sessionManager,
		api = "openai-completions",
	}: { files?: Record<string, string | Buffer>; sessionManager?: (dir: string) => SessionManager; api?: string } = {},
) {
	const dir = await mkdtemp(join(tmpdir(), "pi-media-session-"));
	for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
	await mkdir(join(dir, "skills", "greet"), { recursive: true });
	await writeFile(join(dir, "skills", "greet", "SKILL.md"), "---\nname: greet\ndescription: Greets.\n---\nSay hello.\n");
	await mkdir(join(dir, "prompts"));
	await writeFile(join(dir, "prompts", "review.md"), "---\ndescription: Review.\n---\nReview $@ carefully.\n");

	const gates: Array<() => void> = [];
	const requests: Request[] = [];
	const faux = fauxProvider({ api });
	const respond: FauxResponseFactory = async (context, options, _state, model) => {
		const payload = userPayload(context.messages);
		requests.push({ messages: context.messages, payload: (await options?.onPayload?.(payload, model)) ?? payload });
		await new Promise<void>((resolve) => gates.push(resolve));
		return fauxAssistantMessage("ok");
	};
	faux.setResponses(Array.from({ length: 50 }, () => respond));

	const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerNativeProvider(faux.provider);
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const resourceLoader = new DefaultResourceLoader({
		cwd: dir,
		agentDir: dir,
		settingsManager,
		extensionFactories: extensions,
		noContextFiles: true,
		additionalSkillPaths: [join(dir, "skills")],
		additionalPromptTemplatePaths: [join(dir, "prompts")],
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd: dir,
		agentDir: dir,
		model: faux.getModel(),
		modelRuntime,
		resourceLoader,
		settingsManager,
		sessionManager: sessionManager?.(dir) ?? SessionManager.inMemory(dir),
		tools: [],
	});

	async function waitForCall() {
		while (gates.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
	}

	// Lets every waiting and later model call finish until `run` resolves and the session is idle.
	async function settle(run: Promise<unknown>) {
		const timer = setInterval(() => {
			for (const gate of gates.splice(0)) gate();
		}, 1);
		try {
			await run;
			await session.waitForIdle();
		} finally {
			clearInterval(timer);
		}
	}

	return { session, dir, requests, waitForCall, settle };
}
