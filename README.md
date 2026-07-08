# pi-media

Send media URLs (images, audio, documents, video…) to the upstream LLM provider as attachment content blocks. `/media <url> [prompt]` passes the URL through as-is — no downloading, no base64 — targeting gateways that accept URL attachments in OpenAI-style payloads, such as [Hebo](https://hebo.ai/docs/gateway/attachments).

Pi's message pipeline only supports text and base64 images, so URL attachments can't be expressed directly. This package works around that with a two-step design.

## How it works

- **Sentinel message.** `/media` sends a normal user message containing a marker like `[[pi-media:https://example.com/doc.md|text/markdown]]` (plus your prompt, if given). Being plain text, it persists in the session and coexists with any other context-management packages. The media type is detected from the URL's file extension, falling back to a `HEAD` request's `Content-Type`.
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
| `/media <url> [prompt]` | Attach the media at `<url>` and send it to the model, optionally with an accompanying prompt. The URL must be `http(s)`. |

## Behaviour notes

- The URL is forwarded untouched — whether the media kind is supported is decided by the gateway and the upstream model.
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
