# pi-media

Attach local images, audio, video and PDFs to your messages with pi's `@` mention. `@report.pdf` reaches the model as a real attachment, instead of a path it has to open with the `read` tool.

## Install

```bash
pi install npm:@8monkey/pi-media
```

## Usage

```
what's wrong with this recording? @debug-session.mp3
compare @"Q3 report.pdf" with @q4-report.pdf
```

Paths resolve against the session's working directory. Quote paths that contain spaces, which is what pi's `@` autocomplete does for you.

The attachment is re-sent on every turn, so you can keep asking about the same file later in the conversation.

## Supported files

| Kind | Extensions |
|---|---|
| Image | `png` `jpg` `jpeg` `webp` `gif` `heic` `heif` |
| Audio | `wav` `mp3` `aac` `flac` `ogg` `aiff` `aif` |
| Video | `mp4` `mov` `webm` `mpeg` `mpg` `avi` `wmv` `flv` `3gp` |
| Document | `pdf` |

## Providers

Attachments are sent today for models served through the [Hebo](https://hebo.ai/docs/gateway/attachments) gateway. On other providers, such as Anthropic direct, Bedrock or the Gemini API, the mention is passed along as text and nothing breaks.

Planned, in rough order: Gemini API and Vertex, Anthropic and Bedrock (images and PDFs only), OpenAI, OpenRouter.

## Limits

- A mention that doesn't point at an existing, non-empty file stays as you typed it.
- Files over 20 MB are left as plain `@path` text. Host large media and reference it another way.
- Errors from the provider, for instance an unsupported media kind or an oversized request, appear in the UI unchanged.

No runtime dependencies, no build step. Runs under Node and Bun.

## Development

```bash
node --test
npm run typecheck
```

## License

MIT
