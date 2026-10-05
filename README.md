# pi-media

Attach local images, audio, video and PDFs to your messages. Type a path, drag a file into the terminal, or paste with Ctrl+V. If the provider API accepts the file type, the model gets the file as an attachment. If not, the model gets the path as text.

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

pi-media finds these paths in your message:

- `@` mentions: `@screen.png` and `@"Q3 report.pdf"`. Pi's `@` autocomplete writes them for you.
- Paths that start with `/`, `~/`, `./` or `../`.
- `file://` URIs, for example `file:///Users/me/My%20File.pdf`.

A path must start at the start of the message, after a space or a line break, or after `(`, `[` or `{`. A `/` in a word or in a URL, for example `https://example.com/a.png`, does not start a path.

Paths can have spaces in them when you write them in one of these forms:

- With backslashes: `/Users/me/My\ File.png`. Terminal.app, iTerm2, Ghostty and WezTerm write dragged files like this.
- In single quotes: `'/Users/me/My File.png'`. Kitty, VS Code and GNOME Terminal write dragged files like this.
- In double quotes: `"/Users/me/My File.png"`.
- Alone on a line: `/Users/me/My File.png`. When you paste copied files with Ctrl+V, pi writes each path on its own line like this.

A message can have many paths, with spaces or line breaks between them. When you drag many files, pi-media attaches all of them.

When you paste an image with Ctrl+V, pi writes it to a temporary file such as `/tmp/pi-clipboard-<id>.png` and puts that path in your message. pi-media attaches that file.

pi-media finds files with the same rules as pi's `read` tool:

- Relative paths start from the working directory of the session.
- `~` is your home directory.
- On macOS, a screenshot name such as `Screenshot 2024-01-01 at 10.00.00 AM.png` has a narrow no-break space before `AM`. A normal space in the path also finds the file.
- A name with accents or a curly apostrophe (`’`) also matches when you type it with a straight apostrophe (`'`) or in a different Unicode form.

## Supported files

pi-media finds the type of a file from its first bytes. The file extension has no effect.

| Kind | Types | Type check |
|---|---|---|
| Image | PNG, JPEG, GIF, WebP, BMP | Pi's own image check |
| Audio | All `audio/*` types | The [`file-type`](https://github.com/sindresorhus/file-type) package |
| Video | All `video/*` types | The `file-type` package |
| Document | PDF | The `file-type` package |

## Your message

Your message text stays as you typed it, with the path in it, for all kinds of files.

## Images

pi-media gives images to pi, and pi handles them the same way as all other images:

- Pi resizes large images.
- Pi stores the images in the session with your message.
- If the model does not accept images, pi sends a placeholder text.
- The `blockImages` setting applies.

pi-media does not attach HEIC and HEIF files, because pi does not detect them. A file with an image extension but other content stays as text.

## Audio, video and PDFs

pi-media reads the file when you send the message and stores its bytes in the session, next to your message. Later turns and resumed sessions send the stored bytes. If the file changes or you delete it, the model still gets the file as it was when you sent the message.

On each request, pi-media looks at the API of the model and formats the stored files for that API.

| API | Kinds | Part in the request |
|---|---|---|
| OpenAI-compatible Chat Completions (`openai-completions`) | PDF, wav and mp3 audio | `{"type":"file","file":{"filename":"<name>","file_data":"data:application/pdf;base64,<base64>"}}` for PDFs, `{"type":"input_audio","input_audio":{"data":"<base64>","format":"wav"}}` for audio (`wav` or `mp3`) |
| Gemini API (`google-generative-ai`) and Vertex AI (`google-vertex`) | Audio, video, PDF | `{"inlineData":{"mimeType":"<mime>","data":"<base64>"}}` |
| Anthropic Messages (`anthropic-messages`) | PDF | `{"type":"document","source":{"type":"base64","media_type":"application/pdf","data":"<base64>"}}` |
| Amazon Bedrock Converse (`bedrock-converse-stream`) | PDF, video, audio | `document` (format `pdf`), `video` and `audio` blocks with the raw bytes |
| OpenAI Responses, Azure OpenAI Responses and OpenAI Codex (`openai-responses`, `azure-openai-responses`, `openai-codex-responses`) | PDF | `{"type":"input_file","filename":"<name>","file_data":"data:application/pdf;base64,<base64>"}` |
| OpenRouter (`openai-completions`, provider `openrouter`) | PDF; audio (wav, mp3, aiff, aac, ogg, flac, m4a); video (mp4, mpeg, webm) | PDF: the Chat Completions `file` part; audio: `{"type":"input_audio","input_audio":{"data":"<base64>","format":"<format>"}}`; video: `{"type":"video_url","video_url":{"url":"data:<mime>;base64,<base64>"}}` |
| All other APIs | None | The path stays as text |

For all other APIs, for example Mistral, the model gets your message with the path as text, and no file.

Chat Completions gets video, and audio other than wav and mp3, as path text. A provider that does not accept these parts returns an error. The error shows in the UI unchanged.

Virtual models use the API `pi-virtual`, so pi-media cannot find the API of the model that answers. A virtual model gets the path as text, and no file. This is a known limit.

The Gemini API limits a request with inline audio or video to 20 MB in total. If a request is too large, the provider error shows in the UI unchanged.

The Anthropic Messages API has no block for audio or video, so the model gets the path of these files as text. A request can have at most 32 MB and 600 PDF pages.

Bedrock gets a document name made from the file name, with only letters, digits, single spaces, hyphens, parentheses and square brackets. Video and audio types that Converse has no format for stay as text.

The Responses API gets audio and video as path text. OpenAI accepts at most 50 MB of files in one request.

OpenRouter models accept only some of these formats. If a model does not accept a format, the OpenRouter error shows in the UI unchanged. MOV video stays as text.

## Limits

- A path stays as you typed it if it does not point to an existing, non-empty file of a supported type. Directories, missing files, empty files and other file types stay as text.
- pi-media does not attach files larger than 20 MB. The path stays as text.
- A path without quotes or backslashes ends at the first space if its line has other text. In `see /Users/me/My File.png`, pi-media looks for `/Users/me/My`, and the text stays as you typed it.
- pi-media finds the stored file of a message by its text. Audio, video and PDFs do not attach to a message that starts with a skill (`/skill:name`) or a prompt template (`/name`), because pi replaces the text of these messages.
- A message gets the files of one stored entry at most. If you clear the message queue, or edit a message in the session tree, the stored files of that message stay unused. A later message with the same text that attaches no files of its own gets these files.
- Errors from the provider, for example an unsupported media kind or a request that is too large, show in the UI unchanged.

## Requirements

Node 22 or later, or Bun. pi-media has no build step.

## Development

Run all checks before you commit. This command runs the Biome format and lint checks, the type check, and the tests:

```bash
npm run check
```

To fix the format of the files, run `npm run format`.

## License

MIT
