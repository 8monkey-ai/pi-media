# pi-media

pi-media is a [pi](https://github.com/earendil-works/pi) extension that attaches local images, audio, video and PDF files to your message when you mention them with `@`.

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

When you type `@`, pi lets you search for a file and writes the mention for you. Put double quotes around a path with spaces, for example `@"Q3 report.pdf"`.

- A mention starts at the start of the message, after a space, a tab or a line break, or after `(`, `[` or `{`.
- A relative path starts from the working directory of the session.
- At the end of a mention without quotes, pi-media ignores the characters `)`, `]`, `,`, `.`, `;`, `:`, `!` and `?`. For example, in `(see @a.pdf).` pi-media finds `a.pdf`.

A message can have many mentions. pi-media attaches all of them.

## What gets attached

pi-media attaches a file when all of these conditions are true:

- The path points to a file, not to a directory.
- The file is not empty.
- The file is not larger than 20 MiB.
- The file has one of these types:

| Kind | Types | How pi-media finds the type |
|---|---|---|
| Image | PNG, JPEG, GIF, WebP, BMP | From the content of the file, with pi's own image check |
| Audio | `wav` `mp3` `aac` `flac` `ogg` `aiff` `aif` | From the file name extension |
| Video | `mp4` `mov` `webm` `mpeg` `mpg` `avi` `wmv` `flv` `3gp` | From the file name extension |
| Document | `pdf` | From the file name extension |

If a condition is false, the mention stays as text and no file attaches.

### Images

- Animated PNG, HEIC and HEIF files stay as text.
- Your message text stays as you typed it, with the mention in it.
- pi-media gives images to pi. Pi handles them as it handles other images in a message. For example, the settings `images.autoResize` and `images.blockImages` apply, and a model without image input gets a text note instead of the image.

### Audio, video and PDF files

pi-media replaces the mention in your message with a marker of the form `[[pi-media:<path>|<type>]]`. Before each request, pi-media reads the file and puts it in place of the marker (see [Providers](#providers)).

- Each later turn sends the file again, so you can ask about it later in the conversation.
- If you change the file, the next request sends the new content.
- If you delete the file, the marker stays as text.

## Providers

pi-media changes the `messages` list of each request, for all APIs. In each message, it puts this content part in place of a marker:

```json
{ "type": "file", "file": { "data": "<base64>", "media_type": "<type>" } }
```

Gateways that accept this part get the file. A provider that rejects the part returns an error, and pi shows it. If the request has no `messages` list, or its messages hold text in a different form, for example in the Gemini API, the marker stays as text.

## Limits

- A mention without quotes ends at the first space.
- Only `@` mentions attach files. Other paths in your message stay as text.
- Errors from the provider, for example for a file type that it does not accept or a request that is too large, show in pi unchanged.

pi-media has no runtime dependencies. It runs under Node and Bun.

## Development

pi-media has no build step. Pi loads the TypeScript files in `src/` directly.

To run the Biome format and lint checks, the type check and the tests, run:

```bash
npm run check
```

To fix the format of the files, run `npm run format`.

## License

MIT
