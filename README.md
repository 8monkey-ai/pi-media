# pi-media

pi-media is a [pi](https://github.com/earendil-works/pi) extension. When you write the path of a local image, audio, video or PDF file in your message, pi-media attaches the file. The model can also read audio, video and PDF files with the `read` tool. For images, audio and PDF files, you can set a media model. It reads the file and gives text to the main model.

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

Type a path, drag a file into the terminal, or paste. Your message keeps the paths as you typed them. If pi-media can send the file (see [What gets attached](#what-gets-attached) and [Providers](#providers)), the model also gets the file. If not, the model gets only the path. If you set a media model for the file type, the main model gets the text from the media model in place of the file (see [Media models](#media-models)).

To paste, press Ctrl+V (Alt+V on Windows and WSL). You can paste an image on all platforms. On macOS, you can also paste copied files. On Windows and Linux, copied files do not paste as paths.

### Path forms

pi-media finds these paths in your message:

- `@` mentions, for example `@screen.png`, `@docs/notes.pdf` and `@"Q3 report.pdf"`. When you type `@`, pi lets you search for a file and writes the mention for you.
- Paths that start with `/`, `~/`, `./` or `../`.
- `file://` URIs, for example `file:///Users/me/My%20File.pdf`.
- On Windows, paths that start with a drive (`C:\` or `C:/`), with `\\` for a network share (`\\server\share\a.pdf`), or with `.\`, `..\` or `~\`.

A relative path such as `docs/notes.pdf` must start with `./` or `@`. It starts from the working directory of the session. `~` is your home directory.

pi-media ignores punctuation directly after a path. For example, in `(see ./a.pdf).` it finds `./a.pdf`.

A message can have many paths. pi-media attaches all of them.

### Paths with spaces

Write a path with spaces in one of these forms:

- In single quotes: `'/Users/me/My File.png'`.
- In double quotes: `"/Users/me/My File.png"`.
- On macOS and Linux, with a backslash before each space: `/Users/me/My\ File.png`.
- Alone on a line: `/Users/me/My File.png`.

## What gets attached

pi-media attaches a file that is not empty, is not larger than `maxAttachmentBytes` (20 MiB by default, see [Settings](#settings)), and has one of these types:

| Kind | Types |
|---|---|
| Image | PNG, JPEG, GIF, WebP, BMP |
| Audio | All audio types |
| Video | All video types |
| Document | PDF |

pi-media finds the type of a file from its content, not from its file name extension. Animated PNG, HEIC and HEIF images do not attach.

pi-media reads the file when you send the message, or when the `read` tool reads it. Later turns and resumed sessions use the file as it was then. If you change or delete the file, the model still gets the old file.

## Providers

Images go to all models that take images. Audio, video and PDF files go only to models that use the OpenAI Chat Completions API, for example OpenRouter models. Other models get the path as text and no file.

pi-media sends these types:

| Kind | Types |
|---|---|
| Document | PDF |
| Audio | WAV, MP3, AIFF, AAC, Ogg, FLAC, M4A |
| Video | MP4, MPEG, WebM |

pi-media does not send other types, for example Opus audio or MOV video.

Some providers do not accept all of these types:

- OpenAI's own API accepts PDF, and audio in WAV and MP3. It does not accept video.
- Hebo Gateway does not accept video, or audio in AAC and AIFF.

If a provider does not accept a file, or the request is too large, pi shows the error. Each later turn sends the file again and fails in the same way. To continue, switch to a different model, or use `/tree` to go back to a point before the file.

Virtual models (`pi-virtual`) get no files.

## Media models

A media model reads a file and gives text: a description and the text of an image, a transcript of audio, or the text of a PDF. When you set a media model for a file type, pi-media sends each file of that type to it, also when the main model can take the file. The main model gets the text in place of the file, so this works with all main models. Video files always go to the main model.

### Setup

In the terminal UI:

1. Open `/model`, select the main chat model, and press Ctrl+S to save it as the default.
2. Set the media models with `/media-models`.

Without the terminal UI, write the media models in `pi-media.json` (see [Settings](#settings)).

### The `/media-models` command

`/media-models` asks for a file type, a model and an API. The model list has all models that pi has credentials for. For a model that is not in the list, select `Type a model…` and type `provider/model-id`. Select the API `openai-completions` for a chat model, or `openai-transcriptions` for a transcription model. To remove the setting, select `Not set`. The command saves the setting in `pi-media.json`, and pi-media uses it from the next message.

A chat model reads images, and audio and PDF files in the types that [Providers](#providers) lists. For other types, for example Opus audio, you get an error note.

### What you see

- While the media model works, the terminal UI shows a progress message, for example `Transcribing call.m4a with hebo/gpt-transcribe…`. Esc stops it and the calls for the next files in the message.
- The text shows in the chat after your message, collapsed. Ctrl+O expands it.
- If the call fails or you stop it, the main model gets an error note in place of the file. The note names the model, the file and the reason, for example `pi-media: hebo/gpt-transcribe could not transcribe call.m4a: 413 File too large.`
- pi-media stores the text or the note in the session. Later turns and resumed sessions use it, and do not call the media model again. To try again, send the file again.
- The footer shows the media models that are set, for example `media: image hebo/gpt-4.1-mini, audio hebo/gpt-transcribe`.

## The read tool

pi-media replaces pi's `read` tool with a `read` tool that also reads audio, video and PDF files:

- If you set a media model for the file type, the tool sends the file to the media model, and the model gets the text or an error note. Each read calls the media model again.
- For an audio, video or PDF file, the model gets the file. If the file is larger than `maxAttachmentBytes`, or the current model cannot take the file (see [Providers](#providers)), the model gets a note and no file.
- All other files, images too, work as with pi's `read` tool.

If another extension also registers a `read` tool, pi uses the `read` tool of the extension that loads first.

## Settings

pi-media reads its settings from `~/.pi/agent/pi-media.json`, or from `$PI_CODING_AGENT_DIR/pi-media.json` if you set `PI_CODING_AGENT_DIR`. If the file or a setting is missing, pi-media uses the default.

| Setting | Default | Effect |
|---|---|---|
| `maxAttachmentBytes` | `20971520` (20 MiB) | The size in bytes of the largest file that pi-media attaches or sends to a media model. pi-media holds each attached file in memory, so a larger value can use more memory. |
| `imageModel` | Not set | The media model for images. |
| `audioModel` | Not set | The media model for audio files. |
| `documentModel` | Not set | The media model for PDF files. |

A media model setting has these fields. You must set all of them.

| Field | Value |
|---|---|
| `provider` | A provider that pi knows, for example `hebo`. |
| `id` | The model ID at that provider. |
| `api` | `openai-completions` for a chat model, or `openai-transcriptions` for a transcription model. |

Example, for a limit of 50 MiB, an image model and an audio model:

```json
{
  "maxAttachmentBytes": 52428800,
  "imageModel": { "provider": "hebo", "id": "gpt-4.1-mini", "api": "openai-completions" },
  "audioModel": { "provider": "hebo", "id": "gpt-transcribe", "api": "openai-transcriptions" }
}
```

- After you change the file by hand, run `/reload` or start pi again.
- pi-media ignores keys that it does not know.
- If pi-media cannot read the file, the file is not a JSON object, or a setting has a wrong value, pi-media does not load. pi shows an error that names the file and, for a wrong value, the setting.
- If pi does not know the provider of a media model, pi shows an error when the session starts, and pi-media is off for the session. To turn pi-media on again, correct the setting with `/media-models`, or correct the file and run `/reload`.

## Limits

- A path without quotes or backslashes ends at the first space if its line has other text. In `see /Users/me/My File.png`, no file attaches.
- On Windows, a path with an apostrophe in its file name does not attach in single quotes. Use double quotes, or put the path on a line of its own.
- Audio, video and PDF files do not attach to a message that starts with a skill command (`/skill:name`) or a prompt template command (`/name`). Images attach, and media models work as usual.
- If you send a message with a file for a media model while the agent works, the main model gets an extra turn with only the text from the media model, before the turn with your message.

## Requirements

- pi
- Node 22.19 or later

## Development

pi-media has no build step. Pi loads the TypeScript files in `src/` directly. To run the format, lint, type and test checks, run `npm run check`. To fix the format, run `npm run format`.

## License

MIT
