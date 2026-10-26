import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AssistantMessage,
	type FauxResponseFactory,
	fauxAssistantMessage,
	fauxProvider,
	type Message,
	type OpenAICompletionsCompat,
} from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionFactory,
	type ExtensionUIContext,
	type InputEvent,
	initTheme,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

type ModelRequest = { messages: Message[]; payload: unknown };

// The faux provider sends no payload of its own. This one has the Chat Completions shape of user messages,
// so that `before_provider_request` handlers run on every model call.
function userPayload(messages: Message[]) {
	return { messages: messages.filter((message) => message.role === "user").map(({ role, content }) => ({ role, content })) };
}

type SessionOptions = {
	files?: Record<string, string | Buffer>;
	sessionManager?: (dir: string) => SessionManager;
	api?: string;
	compat?: OpenAICompletionsCompat;
	tools?: string[];
	reply?: (messages: Message[]) => AssistantMessage;
	payload?: (messages: Message[]) => unknown;
	mode?: "tui" | "rpc" | "print";
};

// Extensions find their config through `getAgentDir()`, so it names the session directory while they load.
async function loadExtensions(resourceLoader: DefaultResourceLoader, agentDir: string) {
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		await resourceLoader.reload();
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	}
}

type CustomFactory = Parameters<ExtensionUIContext["custom"]>[0];

// `custom` records the text of each component that it shows, and `press` sends keys to the component that shows now.
function recordingUI() {
	const notifications: Array<{ message: string; type?: string }> = [];
	const statuses: Record<string, string> = {};
	const customs: string[] = [];
	let shown: Awaited<ReturnType<CustomFactory>> | undefined;
	// Pi's components read the global theme, which pi sets up in the terminal UI.
	initTheme();
	const theme = { fg: (_color: string, text: string) => text } as never;
	const custom = (factory: CustomFactory) =>
		new Promise((resolve) => {
			const done = (result: unknown) => {
				shown?.dispose?.();
				resolve(result);
			};
			void Promise.resolve(factory({ requestRender() {} } as never, theme, {} as never, done)).then((component) => {
				shown = component;
				customs.push(component.render(80).join("\n"));
			});
		});
	// The extensions under test call only `notify`, `setStatus` and `custom`.
	const uiContext = {
		custom,
		notify: (message, type) => {
			notifications.push({ message, type });
		},
		setStatus: (key, text) => {
			if (text === undefined) delete statuses[key];
			else statuses[key] = text;
		},
	} as ExtensionUIContext;
	const press = (data: string) => shown?.handleInput?.(data);
	return { notifications, statuses, customs, press, uiContext };
}

// Drives a real pi session with an in-memory session manager and pi-ai's faux provider.
// Binding the UI emits `session_start`, as pi does at startup.
// A model call waits until `settle` runs, so a test can queue input while pi streams.
// `files` go into the working directory, which is also the agent directory.
// `api` is the API of the model. Its default, Chat Completions, is the shape of the default payload.
// `compat` is the compat setting of the model.
// `tools` names the active tools.
// `reply` makes the answer of the model from the request messages, for example a tool call.
// `payload` makes the provider payload from the request messages.
// `mode` is the mode that pi runs in. Print mode has no UI.
export async function startSession(
	extensions: ExtensionFactory[],
	{
		files = {},
		sessionManager,
		api = "openai-completions",
		compat,
		tools = [],
		reply = () => fauxAssistantMessage("ok"),
		payload: makePayload = userPayload,
		mode = "tui",
	}: SessionOptions = {},
) {
	const dir = await mkdtemp(join(tmpdir(), "pi-media-session-"));
	for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);

	const gates: Array<() => void> = [];
	const requests: ModelRequest[] = [];
	const faux = fauxProvider({ api });
	const respond: FauxResponseFactory = async (context, options, _state, model) => {
		const payload = makePayload(context.messages);
		requests.push({ messages: context.messages, payload: (await options?.onPayload?.(payload, model)) ?? payload });
		await new Promise<void>((resolve) => gates.push(resolve));
		return reply(context.messages);
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
	});
	await loadExtensions(resourceLoader, dir);
	const { session } = await createAgentSession({
		cwd: dir,
		agentDir: dir,
		model: { ...faux.getModel(), compat },
		modelRuntime,
		resourceLoader,
		settingsManager,
		sessionManager: sessionManager?.(dir) ?? SessionManager.inMemory(dir),
		tools,
	});
	const { uiContext, customs, press, ...ui } = recordingUI();
	await session.bindExtensions(mode === "print" ? { mode } : { uiContext, mode });

	async function waitFor(condition: () => boolean) {
		while (!condition()) await new Promise((resolve) => setTimeout(resolve, 1));
	}
	const waitForCall = () => waitFor(() => gates.length > 0);

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

	return { session, dir, requests, ui, customs, press, waitFor, waitForCall, settle };
}

// Runs after pi-media and records the input that pi-media passes on.
export function inputObserver() {
	const inputs: Pick<InputEvent, "text" | "images">[] = [];
	const observer: ExtensionFactory = (pi) => {
		pi.on("input", ({ text, images }) => {
			inputs.push({ text, images });
			return { action: "continue" };
		});
	};
	return { inputs, observer };
}
