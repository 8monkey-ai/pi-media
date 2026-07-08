# pi-media

Send media URLs (images, audio, documents, video…) to the upstream LLM provider as attachment content blocks. URLs with a recognized media extension in your messages are attached automatically; `/media <url> [prompt]` handles the rest. The URL passes through as-is — no downloading, no base64 — targeting gateways that accept URL attachments in OpenAI-style payloads, such as [Hebo](https://hebo.ai/docs/gateway/attachments).

Pi's message pipeline only supports text and base64 images, so URL attachments can't be expressed directly. This package works around that with a two-step design.

## How it works

- **Auto-attach on input.** Any `http(s)` URL in a user message whose file extension maps to a known media type (images, audio, video, PDF, markdown, Office formats…) is converted in place to an attachment marker before the message is sent. URLs without a recognized extension — plain links, web pages — are left untouched.
- **Sentinel message.** Markers look like `[[pi-media:https://example.com/doc.md|text/markdown]]`. `/media` produces the same marker explicitly, for URLs auto-detection misses (no extension in the path); it detects the media type from the extension, falling back to a `HEAD` request's `Content-Type`. Being plain text, markers persist in the session and coexist with any other context-management packages.
- **Payload rewrite.** A `before_provider_request` hook rewrites the serialized provider payload just before the HTTP request, replacing each marker with `{ "type": "file", "data": "<url>", "mediaType": "<mime>" }`. The rewrite runs on every request, so attachments are re-sent on later turns while the message remains in context.

If the upstream provider doesn't support URL attachments (or the media kind), its error message is reported back through Pi's normal error display.

Zero runtime dependencies. Pi loads the TypeScript directly, so there's no build step. Runs under Node or Bun.

## Install

```bash
pi install npm:@8monkey/pi-media
```

## Command

| Command | Description |
|---|---|
| `/media <url> [prompt]` | Attach the media at `<url>` and send it to the model, optionally with an accompanying prompt. The URL must be `http(s)`. Useful when auto-attach doesn't trigger (no media extension in the URL path). |

## Behaviour notes

- The URL is forwarded untouched — whether the media kind is supported is decided by the gateway and the upstream model.
- Auto-attach is extension-based only: it never makes network calls at input time, and `.html` links are excluded (links in chat are usually references, not attachments).
- Provider errors (unsupported media, unreachable URL, …) surface as-is in the UI.
- If the rewrite is inactive (e.g. the package is removed later), the model just sees the readable marker text.
- The rewrite targets OpenAI-style payloads (`messages[].content`); other payload shapes pass through unchanged.

## Development

```bash
node --test
npm run typecheck
```

## License

MIT
