# pi-media

pi-media is a [pi](https://github.com/earendil-works/pi) extension that attaches local images, audio, video and PDF files to your message when you write their paths in it. The model can also read audio, video and PDF files with the `read` tool. For images, audio and PDF files, you can set a media model. It reads the file and gives back text for the main model.

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

Type a path, drag a file into the terminal, or paste. Your message text stays as you typed it, with the paths in it. If pi-media can send the file to the model (see [What gets attached](#what-gets-attached) and [Providers](#providers)), the model also gets the file. If not, the path stays as text. If you set a media model for the file type, the main model gets the text from the media model in place of the file (see [Media models](#media-models)).

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

At the end of a path without quotes, pi-media ignores the characters `)`, `]`, `,`, `.`, `;`, `:`, `!` and `?`. For example, in `(see ./a.pdf).` pi-media finds `./a.pdf`. This rule does not apply to a path with spaces that is alone on its line.

A message can have many paths. pi-media attaches all of them.

### Paths with spaces

Write a path with spaces in one of these forms:

- In single quotes: `'/Users/me/My File.png'`.
- In double quotes: `"/Users/me/My File.png"`.
- On macOS and Linux, with a backslash before each space: `/Users/me/My\ File.png`.
- Alone on a line: `/Users/me/My File.png`. When you paste copied files with Ctrl+V on macOS, pi writes each path on a line of its own.

On Windows, a backslash is a part of the path, also in double quotes. Use quotes or a line of its own for a path with spaces: `"C:\Users\me\My File.png"`.

Terminals usually write a dragged file in one of these forms. Windows Terminal and the Windows console put double quotes around a path with spaces. The VS Code terminal with PowerShell writes `& 'C:\Users\me\My File.png'`, and pi-media finds the quoted path in it.

### How a path finds the file

pi-media finds a file with the same rules as pi's `read` tool. A relative path starts from the working directory of the session, and `~` is your home directory.

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

- pi-media finds the type of a file from its content, not from its file name extension. For images, it uses pi's own image check. For other files, it uses the [`file-type`](https://github.com/sindresorhus/file-type) package. Animated PNG, HEIC and HEIF files do not attach.
- pi-media gives images to pi. Pi handles them as it handles other images in a message. For example, the settings `images.autoResize` and `images.blockImages` apply, and a model without image input gets a text note instead of the image. This does not apply to an image that goes to a media model.
- pi-media reads an audio, video or PDF file when you send the message. It stores the bytes in the session as base64 text, which is about 1.33 times the file size. It stores the files that the `read` tool reads in the same way. For a file that goes to a media model, pi-media stores only the text.
- Later turns and resumed sessions use the stored bytes. If you change or delete the file, the model still gets the file as it was when pi-media read it.
- A file that you name two times in one message attaches one time.

## Providers

Only models with the OpenAI Chat Completions API (`openai-completions`) get audio, video and PDF files. This applies to all providers that use this API, for example OpenRouter. Images go through pi, as [What gets attached](#what-gets-attached) states.

pi-media sends these types in the part forms that OpenRouter documents, in your message and in read tool results:

| Kind | Types | Part |
|---|---|---|
| Document | PDF | `file`, with the file name in `filename` and a `data:` URL in `file_data` |
| Audio | WAV, MP3, AIFF, AAC, Ogg, FLAC, M4A | `input_audio`, with the base64 data and the format `wav`, `mp3`, `aiff`, `aac`, `ogg`, `flac` or `m4a` |
| Video | MP4, MPEG, WebM | `video_url`, with a `data:` URL |

pi-media does not send other types, for example Opus audio or MOV video.

Not all providers accept all of these parts:

- OpenAI's own API accepts only PDF, and audio in WAV and MP3. It has no `video_url` part.
- Hebo Gateway does not accept `video_url` parts or the audio formats `aac` and `aiff`.

A provider that rejects a part, or a request that is too large, returns an error, and pi shows it. pi-media stores the file in the session, so each later turn on that branch sends the file again and fails in the same way. To continue, switch to a different model, or use `/tree` to go back to a point before the message or the read tool result with the file.

All other APIs get no files. Virtual models (`pi-virtual`) also get no files, because pi-media sees only the API `pi-virtual` and not the API of the model that answers.

## Media models

A media model reads a file and gives back text: a description and the text of an image, a transcript of audio, or the text of a PDF. When you set a media model for a file type, pi-media sends each file of that type to it, also when the main model can take the file. The main model gets the text in place of the file, so this works with all main models. Video files always go to the main model.

### Setup

In the terminal UI:

1. Open `/model`, select the main chat model, and press Ctrl+S to save it as the default.
2. Set the media models with `/media-models`.

Without the terminal UI, write the media models in `pi-media.json` (see [Settings](#settings)).

### The `/media-models` command

`/media-models` asks for a file type, a model and an API. The model list has all models that pi has credentials for. For a model that is not in the list, for example a transcription model, select `Type a model…` and type `provider/model-id`. For a transcription model, select the API `openai-transcriptions`. To remove the setting, select `Not set`. The command saves the setting in `pi-media.json`, and pi-media uses it from the next message.

### How it works

- The media model does not get your message. pi-media uses the credentials and the base URL that pi has for the provider.
- With `openai-completions`, the media model gets a fixed instruction and the file. This works for images, and for audio and PDF files in the types that [Providers](#providers) lists. Other types, for example Opus audio, give an error note.
- With `openai-transcriptions`, the media model gets only the file.
- While the call runs, the terminal UI shows a progress message, for example `Transcribing call.m4a with hebo/gpt-transcribe…`. Esc stops the call and the calls for the next files in the message.
- If a call fails or Esc stops it, the main model gets an error note in place of the file. The note names the model, the file and the reason, for example `pi-media: hebo/gpt-transcribe could not transcribe call.m4a: 413 File too large.`
- The text shows in the chat after your message, collapsed. Ctrl+O expands it.
- pi-media stores the text or the note in the session. Later turns and resumed sessions use it, and do not call the media model again. To try again, send the file again.
- The footer shows the media models that are set, for example `media: image hebo/gpt-4.1-mini, audio hebo/gpt-transcribe`.

## The read tool

pi-media registers its own `read` tool in place of pi's `read` tool. The tool description tells the model that the tool also reads audio, video and PDF files. The tool uses the first of these rules that applies to the file:

- If you set a media model for the file type, the tool sends the file to the media model, and the tool result has the text or an error note. Each read calls the media model again.
- For an audio, video or PDF file, the tool result is a short note, and the model gets the file with it.
- For all other files, images too, the tool runs pi's `read` tool, and the result is the same as without pi-media.

The note for an audio, video or PDF file has this form:

```
Read PDF file [application/pdf]: /Users/me/report.pdf
```

If the file is larger than `maxAttachmentBytes`, the model gets this note and no file:

```
PDF file [application/pdf] is larger than the pi-media limit maxAttachmentBytes (20971520 bytes): /Users/me/report.pdf
```

If pi-media cannot send the file to the model (see [Providers](#providers) and [Limits](#limits)), the model gets this note after the tool result, and no file:

```
[The API of the current model cannot take this file type. The file content is not in this request.]
```

If another extension also registers a `read` tool, pi uses the `read` tool of the extension that loads first.

## Settings

pi-media reads its settings from the file `pi-media.json` in the pi agent directory. This file is `~/.pi/agent/pi-media.json`, or `$PI_CODING_AGENT_DIR/pi-media.json` if you set `PI_CODING_AGENT_DIR`. If the file or a setting is missing, pi-media uses the default.

| Setting | Default | Effect |
|---|---|---|
| `maxAttachmentBytes` | `20971520` (20 MiB) | The size in bytes of the largest file that pi-media attaches or sends to a media model, from your message or from the `read` tool. pi-media holds each attached file in memory as base64 text, so a larger value can use more memory. |
| `imageModel` | Not set | The media model for images. |
| `audioModel` | Not set | The media model for audio files. |
| `documentModel` | Not set | The media model for PDF files. |

A media model setting has these fields. You must set all of them.

| Field | Value |
|---|---|
| `provider` | A provider that pi knows, for example `hebo`. |
| `id` | The model ID at that provider. |
| `api` | `openai-completions` for a chat model that uses `/chat/completions`, or `openai-transcriptions` for a transcription model that uses `/audio/transcriptions`. |

Example, for a limit of 50 MiB, an image model and an audio model:

```json
{
  "maxAttachmentBytes": 52428800,
  "imageModel": { "provider": "hebo", "id": "gpt-4.1-mini", "api": "openai-completions" },
  "audioModel": { "provider": "hebo", "id": "gpt-transcribe", "api": "openai-transcriptions" }
}
```

- pi-media reads the file when pi loads extensions. After you change the file by hand, run `/reload` or start pi again.
- pi-media ignores keys that it does not know.
- If pi-media cannot read the file, the file is not a JSON object, or a setting has a wrong value, pi-media does not load, and pi shows an error with the path of the file. For a wrong value, the error names the setting.
- If pi does not know the provider of a media model, pi shows an error when the session starts, and pi-media is off for the session. Files do not attach, and the `read` tool works as pi's `read` tool. To turn pi-media on again, correct the setting with `/media-models`, or correct the file and run `/reload`.

## Limits

- A path without quotes or backslashes ends at the first space if its line has other text. In `see /Users/me/My File.png`, pi-media looks for `/Users/me/My`, and no file attaches.
- On Windows, a path with an apostrophe in its file name does not attach in single quotes, for example `'C:\Users\me\it''s.png'`, or with `\'` for the apostrophe, for example `don\'t.png`. PowerShell and Git Bash can write paths in these forms. Use double quotes, or put the path on a line of its own.
- Audio, video and PDF files do not attach to a message that starts with a skill command (`/skill:name`) or a prompt template command (`/name`). pi-media stores these files in the session, and no message uses them. Images attach, and files that go to a media model give their text as usual.
- A model with `compat.requiresAssistantAfterToolResult` set to `true` gets no files from the `read` tool. Files in your message attach.
- If a message with files does not get to the model, for example when you clear the message queue or edit a message in the session tree, pi-media keeps its files. A later message with the same text and no files of its own gets these files.
- If you queue two messages with the same text and the file changes between them, each message can get the file as it was for the other message.
- If a tool result ends with lines that hold only text of the form `[[pi-media:<id>:<number>]]`, the model can get the tool result without these lines.
- If you send a message with a file for a media model while the agent works, the main model gets an extra turn with only the text from the media model, before the turn with your message.

## Requirements

- pi
- Node 22.19 or later

## Development

pi-media has no build step. Pi loads the TypeScript files in `src/` directly.

To run the Biome format and lint checks, the type check and the tests, run:

```bash
npm run check
```

To run only the Biome lint check, run `npm run lint`. To fix the format of the files, run `npm run format`.

## License

MIT
