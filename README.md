# pi-media

pi-media is a [pi](https://github.com/earendil-works/pi) extension that attaches local images, audio, video and PDF files to your message when you write their paths in it.

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

Type a path, drag a file into the terminal, or paste.

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
- The file is not larger than 20 MiB.
- The file has one of these types:

| Kind | Types | How pi-media finds the type |
|---|---|---|
| Image | PNG, JPEG, GIF, WebP, BMP | From the content of the file, with pi's own image check |
| Audio | `wav` `mp3` `aac` `flac` `ogg` `aiff` `aif` | From the file name extension |
| Video | `mp4` `mov` `webm` `mpeg` `mpg` `avi` `wmv` `flv` `3gp` | From the file name extension |
| Document | `pdf` | From the file name extension |

If a condition is false, the path stays as text and no file attaches.

### Images

- Animated PNG, HEIC and HEIF files stay as text.
- Your message text stays as you typed it, with the path in it.
- pi-media gives images to pi. Pi handles them as it handles other images in a message. For example, the settings `images.autoResize` and `images.blockImages` apply, and a model without image input gets a text note instead of the image.

### Audio, video and PDF files

pi-media replaces the path in your message, with its `@`, quotes or backslashes, with a marker of the form `[[pi-media:<path>|<type>]]`. Before each request, pi-media reads the file and puts it in place of the marker (see [Providers](#providers)).

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

- A path without quotes or backslashes ends at the first space if its line has other text. In `see /Users/me/My File.png`, pi-media looks for `/Users/me/My`, and no file attaches.
- On Windows, a path without quotes that has `\'` for an apostrophe does not attach, for example `don\'t.png`. The mintty terminal of Git Bash can write a path in this form.
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
