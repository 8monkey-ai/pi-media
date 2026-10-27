import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
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
import { getKeybindings } from "@earendil-works/pi-tui";

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
	models?: string[];
	answers?: Array<string | undefined>;
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

// `custom` records the text of each component that it shows. `press` sends a key to the component that shows now
// and gives the text of the component after the key.
function recordingUI(answerList: Array<string | undefined>) {
	const answers = [...answerList];
	const notifications: Array<{ message: string; type?: string }> = [];
	const statuses: Record<string, string> = {};
	const dialogs: Array<{ title: string; options?: string[] }> = [];
	const answer = () => {
		if (answers.length === 0) throw new Error("The test has no answer for this dialog");
		return Promise.resolve(answers.shift());
	};
	const customs: string[] = [];
	let shown: Awaited<ReturnType<CustomFactory>> | undefined;
	// Pi's components read the global theme, which pi sets up in the terminal UI.
	initTheme();
	const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as never;
	const text = () => stripVTControlCharacters(shown?.render(80).join("\n") ?? "");
	const custom = (factory: CustomFactory) =>
		new Promise((resolve) => {
			const done = (result: unknown) => {
				shown?.dispose?.();
				resolve(result);
			};
			void Promise.resolve(factory({ requestRender() {} } as never, theme, getKeybindings() as never, done)).then((component) => {
				shown = component;
				customs.push(text());
			});
		});
	// The extensions under test call only `notify`, `setStatus`, `custom`, `select` and `input`.
	const uiContext = {
		custom,
		notify: (message, type) => {
			notifications.push({ message, type });
		},
		setStatus: (key, text) => {
			if (text === undefined) delete statuses[key];
			else statuses[key] = text;
		},
		select: (title, options) => {
			dialogs.push({ title, options });
			if (answers[0] !== undefined && !options.includes(answers[0])) {
				throw new Error(`The answer ${JSON.stringify(answers[0])} is not an option of "${title}"`);
			}
			return answer();
		},
		input: (title) => {
			dialogs.push({ title });
			return answer();
		},
	} as ExtensionUIContext;
	const press = (data: string) => {
		shown?.handleInput?.(data);
		return text();
	};
	return { notifications, statuses, customs, dialogs, press, uiContext };
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
// `models` are the IDs of the faux models. The faux provider has credentials, so they are in pi's list of available models.
// `answers` are the replies of the user to `select` and `input`, in order. `undefined` is Esc. `dialogs` records each dialog.
// `errors` records the errors that pi catches in extension handlers and commands, also the errors of the recording UI.
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
		models,
		answers = [],
	}: SessionOptions = {},
) {
	const dir = await mkdtemp(join(tmpdir(), "pi-media-session-"));
	for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);

	const gates: Array<() => void> = [];
	const requests: ModelRequest[] = [];
	const faux = fauxProvider({ api, models: models?.map((id) => ({ id })) });
	const respond: FauxResponseFactory = async (context, options, _state, model) => {
		const payload = makePayload(context.messages);
		requests.push({ messages: context.messages, payload: (await options?.onPayload?.(payload, model)) ?? payload });
		await new Promise<void>((resolve) => gates.push(resolve));
		return reply(context.messages);
	};
	faux.setResponses(Array.from({ length: 50 }, () => respond));

	const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerNativeProvider(faux.provider);
	await modelRuntime.setRuntimeApiKey(faux.provider.id, "faux-key");
	await modelRuntime.refresh({ providers: [faux.provider.id] });
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
	const { uiContext, customs, press, dialogs, ...ui } = recordingUI(answers);
	const errors: string[] = [];
	await session.bindExtensions({
		...(mode === "print" ? { mode } : { uiContext, mode }),
		onError: ({ error }) => errors.push(error),
	});

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

	return { session, dir, requests, ui, customs, press, dialogs, errors, waitFor, waitForCall, settle };
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
