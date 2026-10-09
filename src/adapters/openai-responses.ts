import { basename } from "node:path";
import type {
	ResponseInputFile,
	ResponseInputFileContent,
	ResponseInputText,
	ResponseInputTextContent,
} from "openai/resources/responses/responses";
import { isRecord } from "../is-record.ts";
import { type Build, builderIn, carriesBy } from "./part-for.ts";
import { registerAdapter } from "./registry.ts";
import { type HolderList, rewriteHolders, type TextShape } from "./text-holders.ts";

const inputText: TextShape = {
	content: "content",
	textOf: (node) => (isRecord(node) && node.type === "input_text" && typeof node.text === "string" ? node.text : undefined),
	textNode: (text) => ({ type: "input_text", text }) satisfies ResponseInputText & ResponseInputTextContent,
};

const userItems: HolderList = { ...inputText, list: "input", selects: (item) => item.role === "user" };

// pi-ai joins the text of a tool result into the string `output` of the item, or into its first `input_text` when the
// result has images. The API accepts `input_file` parts in `output`.
const toolOutputItems: HolderList = {
	...inputText,
	list: "input",
	selects: (item) => item.type === "function_call_output" || item.type === "custom_tool_call_output",
	content: "output",
	joinsText: true,
};

const filePart: Build = ({ path, mimeType, data }) =>
	({
		type: "input_file",
		filename: basename(path),
		file_data: `data:${mimeType};base64,${data}`,
	}) satisfies ResponseInputFile & ResponseInputFileContent;

// Responses takes PDFs as input_file parts, in user messages and in tool outputs.
const partFor = (mimeType: string) => (mimeType === "application/pdf" ? filePart : undefined);

for (const api of ["openai-responses", "azure-openai-responses", "openai-codex-responses"]) {
	registerAdapter({
		api,
		carries: carriesBy(partFor),
		rewrite: (payload, attachment) => {
			const users = rewriteHolders(payload, userItems, attachment, builderIn(partFor, "user"));
			return rewriteHolders(users ?? payload, toolOutputItems, attachment, builderIn(partFor, "toolResult")) ?? users;
		},
	});
}
