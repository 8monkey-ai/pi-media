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

Type a path, drag a file into the terminal, or paste. If pi-media can send the file type to the model (see [Providers](#providers)), the model gets the file. If not, the model gets only your message with the path in it.

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
- pi-media reads an audio, video or PDF file when you send the message. It stores the bytes in the session as base64 text, which is about 1.33 times the file size.
- Later turns and resumed sessions use the stored bytes. If you change or delete the file, the model still gets the file as it was when pi-media read it.
- A file that you name two times in one message attaches one time.

## Providers

Only models with the OpenAI Chat Completions API (`openai-completions`) get audio, video and PDF files. This applies to all providers that use this API, for example OpenRouter. Images go through pi, as [What gets attached](#what-gets-attached) states.

pi-media sends these types in the part forms that OpenRouter documents:

| Kind | Types | Part |
|---|---|---|
| Document | PDF | `file`, with the file name in `filename` and a `data:` URL in `file_data` |
| Audio | WAV, MP3, AIFF, AAC, Ogg, FLAC, M4A | `input_audio`, with the base64 data and the format `wav`, `mp3`, `aiff`, `aac`, `ogg`, `flac` or `m4a` |
| Video | MP4, MPEG, WebM | `video_url`, with a `data:` URL |

Not all providers accept all of these parts:

- OpenAI's own API accepts only PDF, and audio in WAV and MP3. It has no `video_url` part.
- Hebo Gateway does not accept `video_url` parts or the audio formats `aac` and `aiff`.

A provider that rejects a part, or a request that is too large, returns an error, and pi shows it. pi-media stores the file in the session, so each later turn on that branch sends the file again and fails in the same way. To continue, switch to a different model, or use `/tree` to go back to a point before the message with the file.

All other APIs get no files. Virtual models (`pi-virtual`) also get no files, because pi-media sees only the API `pi-virtual` and not the API of the model that answers.

When pi-media does not send a file, because the API gets no files or the type is not in the table (for example Opus audio or MOV video), the path stays as text in your message.

## Limits

- A path without quotes or backslashes ends at the first space if its line has other text. In `see /Users/me/My File.png`, pi-media looks for `/Users/me/My`, and no file attaches.
- On Windows, a path without quotes that has `\'` for an apostrophe does not attach, for example `don\'t.png`. The mintty terminal of Git Bash can write a path in this form.
- Audio, video and PDF files do not attach to a message that pi expands from a skill (`/skill:name`) or a prompt template (`/name`). Images attach.
- pi-media stores the files of a message in a session entry of its own, and finds that entry by the message text. Each message gets the files of one entry at most. If a message does not reach the session, for example when you clear the message queue or edit a message in the session tree, its entry stays unused. A later message with the same text that attaches no files of its own then gets the files of that entry. If you queue two messages with the same text and the file changes between them, each message can get the file as it was for the other message.
- pi-media marks the place of a file in a request with text of the form `[[pi-media:<id>:<number>]]`. If your message ends with lines that hold only text of this form, pi-media can remove these lines from the request.

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
