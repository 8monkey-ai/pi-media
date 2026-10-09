# pi-media

pi-media is a [pi](https://github.com/earendil-works/pi) extension that attaches local images, audio, video and PDF files to your message when you write their paths in it. The model can also read audio, video and PDF files with the `read` tool.

## Install

```bash
pi install npm:@8monkey/pi-media
```

## Usage

```
what is in this screenshot? @screen.png
what is wrong with this recording? ~/Downloads/debug-session.mp3
compare @"Q3 report.pdf" with ./q4-report.pdf
```

Type a path, drag a file into the terminal, or paste. If the API of the model can take the file type, the model gets the file. If not, the model gets only your message with the path in it.

To paste, press Ctrl+V (Alt+V on Windows and WSL):

- When you paste an image, pi writes it to the file `pi-clipboard-<id>.<ext>` in the system temporary directory and puts the path of that file in your message. This works on all platforms. pi-media finds this path also when it has spaces or when other text is directly before or after it.
- When you paste copied files on macOS, pi puts the path of each file in your message. On Windows and Linux, pi does not paste copied files as paths.

### Path forms

pi-media finds these paths in your message:

- `@` mentions, for example `@screen.png`, `@docs/notes.pdf` and `@"Q3 report.pdf"`. When you type `@`, pi lets you search for a file and writes the mention for you.
- Paths that start with `/`, `~/`, `./` or `../`.
- `file://` URIs, for example `file:///Users/me/My%20File.pdf`.
- On Windows, paths that start with a drive (`C:\` or `C:/`), with `\\` for a network share (`\\server\share\a.pdf`), or with `.\`, `..\` or `~\`.

A path starts at the start of the message, after a space, a tab or a line break, or after `(`, `[` or `{`. A `/` in a word or in a URL, for example `https://example.com/a.png`, does not start a path. A relative path such as `docs/notes.pdf` must start with `./` or `@`.

A message can have many paths. pi-media attaches all of them.

### Paths with spaces

Write a path with spaces in one of these forms:

- In single quotes: `'/Users/me/My File.png'`.
- In double quotes: `"/Users/me/My File.png"`.
- On macOS and Linux, with a backslash before each space: `/Users/me/My\ File.png`.
- Alone on a line: `/Users/me/My File.png`. When you paste copied files with Ctrl+V on macOS, pi writes each path on a line of its own.

On Windows, a backslash is a part of the path, also in double quotes. Use quotes or a line of its own for a path with spaces: `"C:\Users\me\My File.png"`. In single quotes, pi-media reads `''` and `'\''` as one apostrophe, because PowerShell and Git Bash write an apostrophe in these forms: `'C:\Users\me\it''s.png'`.

Terminals usually write a dragged file in one of these forms. Windows Terminal and the Windows console put double quotes around a path with spaces. The VS Code terminal with PowerShell writes `& 'C:\Users\me\My File.png'`, and pi-media finds the quoted path in it.

### How a path finds the file

pi-media uses the same rules as pi's `read` tool:

- A relative path starts from the working directory of the session.
- `~` is your home directory.
- On Windows, Git Bash, MSYS2 and Cygwin drive paths (`/c/Users/me`, `/cygdrive/c/Users/me`) and WSL drive paths (`/mnt/c/Users/me`) find `C:\Users\me`.
- On macOS, a screenshot name such as `Screenshot 2024-01-01 at 10.00.00 AM.png` has a narrow no-break space before `AM` or `PM`. A normal space in the path also finds the file.
- A file name in decomposed Unicode form (NFD) matches when you type it in composed form.
- A file name with a curly apostrophe (`’`) matches when you type a straight apostrophe (`'`).
- pi-media reads other Unicode space characters in a path as normal spaces.

At the end of a path without quotes, pi-media ignores the characters `)`, `]`, `,`, `.`, `;`, `:`, `!` and `?`. For example, in `(see ./a.pdf).` pi-media finds `./a.pdf`. This rule does not apply to a path with spaces that is alone on its line.

## What gets attached

pi-media attaches a file when all of these conditions are true:

- The path points to a file, not to a directory.
- The file is not empty.
- The file is not larger than `maxAttachmentBytes`, 20 MiB by default (see [Settings](#settings)).
- The file has one of these types:

| Kind | Types |
|---|---|
| Image | PNG, JPEG, GIF, WebP, BMP |
| Audio | All `audio/*` types |
| Video | All `video/*` types |
| Document | PDF |

If a condition is false, the path stays as text and no file attaches.

- pi-media finds the type of a file from its content, not from its file name extension. For images, it uses pi's own image check. For other files, it uses the [`file-type`](https://github.com/sindresorhus/file-type) package.
- Animated PNG, HEIC and HEIF files stay as text.
- Your message text stays as you typed it, with the paths in it.
- pi-media gives images to pi. Pi handles them as it handles other images in a message. For example, the settings `images.autoResize` and `images.blockImages` apply, and a model without image input gets a text note instead of the image.
- pi-media reads an audio, video or PDF file when you send the message. It stores the bytes in the session as base64 text, which is about 1.33 times the file size. It stores the files that the `read` tool reads in the same way.
- Later turns and resumed sessions use the stored bytes. If you change or delete the file, the model still gets the file as it was when pi-media read it.
- A file that you name two times in one message attaches one time.

## Providers

On each request, pi-media puts the stored audio, video and PDF files in the form that the API of the current model takes. Images go through pi, as [What gets attached](#what-gets-attached) states.

| API | In your message | In a read tool result | Notes |
|---|---|---|---|
| Anthropic Messages (`anthropic-messages`) | PDF | PDF | The [Anthropic docs](https://platform.claude.com/docs/en/build-with-claude/pdf-support) give a limit of 32 MB and 600 PDF pages for each request, or 100 pages when the context window is smaller than 1M tokens. |
| Amazon Bedrock Converse (`bedrock-converse-stream`) | PDF; audio: MP3, WAV, FLAC, AAC, Ogg, Opus, MP4 audio, M4A; video: MP4, MOV, WebM, MKV, FLV, MPEG, 3GP | PDF; the same video types | A tool result cannot hold audio. |
| Gemini API (`google-generative-ai`) and Vertex AI (`google-vertex`) | All audio, video, PDF | All audio, video, PDF | |
| OpenAI-compatible Chat Completions (`openai-completions`) | PDF; audio: WAV, MP3 | PDF; audio: WAV, MP3 | Other audio and all video stay as path text. A provider can reject the parts that it gets. |
| OpenRouter (`openai-completions`, provider `openrouter`) | PDF; audio: WAV, MP3, AIFF, AAC, Ogg, FLAC, M4A; video: MP4, MPEG, WebM | The same as in your message | Other video, for example MOV, stays as path text. A model can reject a format. |
| OpenAI Responses, Azure OpenAI Responses and OpenAI Codex (`openai-responses`, `azure-openai-responses`, `openai-codex-responses`) | PDF | PDF | The [OpenAI docs](https://developers.openai.com/api/docs/guides/file-inputs) give a limit of 50 MB for all files in one request. |
| Virtual models (`pi-virtual`) | None | None | pi-media sees only the API `pi-virtual`, not the API of the model that answers. |
| All other APIs | None | None | |

A type that is not in the row of the API stays as path text in your message. In a read tool result, the model gets the note in [The read tool](#the-read-tool) instead.

A provider error, for example for a request that is too large, shows in pi unchanged.

Bedrock needs a name for each document. pi-media makes the name from the file name:

- It removes accents.
- It changes each run of characters other than ASCII letters, digits, hyphens, parentheses and square brackets to one space.
- It keeps at most 200 characters.
- It uses `document` if no characters are left.
- It adds ` (2)`, ` (3)` and so on to a name that an earlier document in the request has.

## The read tool

pi-media registers its own `read` tool in place of pi's `read` tool. The tool description tells the model that the tool also reads audio, video and PDF files. For all other files, images too, the tool runs pi's `read` tool, and the result is the same as without pi-media.

For an audio, video or PDF file, the tool result is a short note, and the model gets the file with it. For example:

```
Read PDF file [application/pdf]: /Users/me/report.pdf
```

If the file is larger than `maxAttachmentBytes`, the model gets this note and no file:

```
PDF file [application/pdf] is larger than the pi-media limit maxAttachmentBytes (20971520 bytes): /Users/me/report.pdf
```

If the API of the model cannot take the file in a tool result (see [Providers](#providers)), the model gets this note after the tool result, and no file:

```
[The API of the current model cannot take this file type. The file content is not in this request.]
```

Each API gets the file of a tool result in a different place:

- Anthropic Messages: a `document` block in the `tool_result` content, after the note.
- Bedrock Converse: a `document` or `video` block in the `toolResult` content.
- OpenAI Responses: an `input_file` part in the `output` of the tool output item, after the note.
- Gemini and Vertex AI: a PDF goes in `functionResponse.parts`. This applies to Gemini 3 and later, and to model ids that do not start with `gemini-<version>` or `gemini-live-<version>`. For older Gemini models, for example `gemini-2.5-flash`, a PDF goes in a user turn after the tool results. Audio and video always go in that user turn. That turn starts with the text `Tool result file:`. If pi has added a `Tool result image:` turn there, pi-media adds the text and the files to that turn.
- Chat Completions and OpenRouter: tool messages take only text, so the files go in a user message after the tool messages. If pi has added a user message for tool result images there, pi-media adds the files to it. If not, pi-media adds a user message that starts with the text `Attached file(s) from tool result:`. For a model with `compat.requiresAssistantAfterToolResult`, an assistant message with the text `I have processed the tool results.` comes before that user message.

If another extension also registers a `read` tool, pi uses the `read` tool of the extension that loads first.

## Settings

pi-media reads its settings from the file `pi-media.json` in the pi agent directory. This file is `~/.pi/agent/pi-media.json`, or `$PI_CODING_AGENT_DIR/pi-media.json` if you set `PI_CODING_AGENT_DIR`. If the file or a setting is missing, pi-media uses the default.

| Setting | Default | Effect |
|---|---|---|
| `maxAttachmentBytes` | `20971520` (20 MiB) | The size in bytes of the largest file that pi-media attaches, from your message or from the `read` tool. A larger file in your message stays as path text. pi-media holds each attached file in memory as base64 text, so a larger value can use more memory. |

Example, for a limit of 50 MiB:

```json
{
  "maxAttachmentBytes": 52428800
}
```

- pi-media reads the file when pi loads extensions. After you change the file, run `/reload` or start pi again.
- pi-media ignores keys that it does not know.
- pi-media does not load, and pi shows an error with the path of the file, in these cases:
  - The file is not valid JSON.
  - The JSON value is not an object, for example an array or a number.
  - `maxAttachmentBytes` is not a positive integer.
  - pi-media cannot read a file that exists.

## Limits

- A path without quotes or backslashes ends at the first space if its line has other text. In `see /Users/me/My File.png`, pi-media looks for `/Users/me/My`, and no file attaches.
- On Windows, a path without quotes that has `\'` for an apostrophe does not attach, for example `don\'t.png`. The mintty terminal of Git Bash can write a path in this form.
- Audio, video and PDF files do not attach to a message that pi expands from a skill (`/skill:name`) or a prompt template (`/name`). Images attach.
- pi-media stores the files of a message in a session entry of its own, and finds that entry by the message text. Each message gets the files of one entry at most. If a message does not reach the session, for example when you clear the message queue or edit a message in the session tree, its entry stays unused. A later message with the same text that attaches no files of its own then gets the files of that entry. If you queue two messages with the same text and the file changes between them, each message can get the file as it was for the other message.
- pi-media marks the place of a file in a request with text of the form `[[pi-media:<id>:<number>]]`. If your message or a tool result ends with lines that hold only text of this form, pi-media can remove these lines from the request.

## Requirements

- pi
- Node 22.19 or later

## Development

pi-media has no build step. Pi loads the TypeScript files in `src/` directly.

To run the Biome format and lint checks, the type check and the tests, run:

```bash
npm run check
```

To fix the format of the files, run `npm run format`.

## License

MIT
