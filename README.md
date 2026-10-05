# pi-media

Attach local images, audio, video and PDFs to your messages with pi's `@` mention. The model gets `@report.pdf` as an attachment. It does not have to open the path with the `read` tool.

## Install

```bash
pi install npm:@8monkey/pi-media
```

## Usage

```
what is in this screenshot? @screen.png
what is wrong with this recording? @debug-session.mp3
compare @"Q3 report.pdf" with @q4-report.pdf
```

Paths resolve against the working directory of the session. Put quotes around paths that contain spaces. Pi's `@` autocomplete does this for you.

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

Your message text stays as you typed it, with the `@` path in it.

pi-media does not attach HEIC and HEIF files, because pi does not detect them. A file with an image extension but other content stays as text.

## Audio, video and PDFs

pi-media replaces the mention with a marker in your message. On each request, it reads the file again and sends it as a chat-completions content part: `{"type":"file","file":{"data":"<base64>","media_type":"<mime>"}}`. Gateways that accept this shape get the file. Other providers, for example Anthropic direct, Bedrock or the Gemini API, get the mention as text.

Planned, in approximate order: Gemini API and Vertex, Anthropic and Bedrock (PDFs only), OpenAI, OpenRouter.

## Limits

- A mention that does not point to an existing, non-empty file stays as you typed it.
- pi-media does not attach files larger than 20 MB. The mention stays as text.
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
