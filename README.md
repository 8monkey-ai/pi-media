# pi-media

Attach local images, audio, video and PDFs to your messages. Type a path, drag a file into the terminal, or paste with Ctrl+V. The model gets the file as an attachment. It does not have to open the path with the `read` tool.

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

| Kind | How pi-media finds the type |
|---|---|
| Image: PNG, JPEG, GIF, WebP, BMP | From the first bytes of the file, with pi's own image check |
| Audio | Extension: `wav` `mp3` `aac` `flac` `ogg` `aiff` `aif` |
| Video | Extension: `mp4` `mov` `webm` `mpeg` `mpg` `avi` `wmv` `flv` `3gp` |
| Document | Extension: `pdf` |

## Images

pi-media gives images to pi, and pi handles them the same way as all other images:

- Pi resizes large images.
- Pi stores the images in the session with your message.
- If the model does not accept images, pi sends a placeholder text.
- The `blockImages` setting applies.

Your message text stays as you typed it, with the path in it.

pi-media does not attach HEIC and HEIF files, because pi does not detect them. A file with an image extension but other content stays as text.

## Audio, video and PDFs

pi-media replaces the path, with its `@`, quotes or backslashes, with a marker in your message. On each request, it reads the file again and sends it as a chat-completions content part: `{"type":"file","file":{"data":"<base64>","media_type":"<mime>"}}`. Gateways that accept this shape get the file. Other providers, for example Anthropic direct, Bedrock or the Gemini API, get the path as text.

Planned, in approximate order: Gemini API and Vertex, Anthropic and Bedrock (PDFs only), OpenAI, OpenRouter.

## Limits

- A path stays as you typed it if it does not point to an existing, non-empty file of a supported type. Directories, missing files, empty files and other file types stay as text.
- pi-media does not attach files larger than 20 MB. The path stays as text.
- A path without quotes or backslashes ends at the first space if its line has other text. In `see /Users/me/My File.png`, pi-media looks for `/Users/me/My`, and the text stays as you typed it.
- Errors from the provider, for example an unsupported media kind or a request that is too large, show in the UI unchanged.

No runtime dependencies, no build step. Runs under Node and Bun.

## Development

Run all checks before you commit. This command runs the Biome format and lint checks, the type check, and the tests:

```bash
npm run check
```

To fix the format of the files, run `npm run format`.

## License

MIT
