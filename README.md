# pi-media

pi-media is a [pi](https://github.com/earendil-works/pi) extension that lets you work with local images, audio, video and PDF files. For example, you can ask what a screenshot shows, get a summary of a recording, or compare two documents.

To give a file to pi, select it with `@`, type its path, paste an image, or drag the file into a terminal that inserts its path. What pi can do with a file depends on your model and its provider.

## Install

```bash
pi install npm:@8monkey/pi-media
```

pi-media needs pi and Node 22.19 or later.

## Send files

Put one or more files in your message:

```
what is in this screenshot? @screen.png
summarize this recording: ~/Downloads/standup.mp3
compare @"Q3 report.pdf" with ./q4-report.pdf
```

- Type `@` to search for a file.
- Type a path that starts with `/`, `~/`, `./` or `../`. A relative path such as `docs/notes.pdf` must start with `./` or `@`. It starts from the working directory of the session.
- Drag a file into the terminal. This works if your terminal inserts the path of the file.
- Paste an image with Ctrl+V (Alt+V on Windows and WSL). On macOS, Ctrl+V also pastes copied files as paths.

For a path with spaces, put it in quotes (`"/Users/me/My File.png"`), put it alone on a line, or, on macOS and Linux, put a backslash before each space (`/Users/me/My\ File.png`).

If pi-media cannot open a file or cannot send it directly, for example because of its format or size, the model gets only the path and no content. If a media model cannot process a file, the chat model gets an error note in place of the text (see [What you see for files in your messages](#what-you-see-for-files-in-your-messages)).

## Supported files

pi-media uses a file that you add by path only if the file is not empty and not larger than 20 MiB. You can change this limit (see [Settings](#settings)).

### Formats sent directly to your chat model

| Kind | Formats |
|---|---|
| Image | PNG, JPEG, GIF, WebP, BMP |
| Audio | WAV, MP3, AIFF, AAC, Ogg, FLAC, M4A |
| Video | MP4, MPEG, WebM |
| Document | PDF |

- **Images** go through pi's own image support. They work with each model that pi can send images to. Animated PNG, HEIC and HEIF images are not supported.
- **Audio, video and PDF files** go directly only when the chat model uses the `openai-completions` API in pi, and the provider and model accept the format. Other formats, for example Opus audio or MOV video, are not sent. In these cases the chat model gets only the path.

For images, audio and PDF files, a media model can give the chat model a text version of the file. Video has no media model.

## Media models (optional)

Your chat model is the model that you select with `/model`. If it cannot read a file type, or you want a text version of the file, set a media model for that type. pi-media asks the media model for:

- Image: a description, and all text that is visible in the image.
- Audio: a transcript.
- PDF: the text, with a description of each chart and image.

When a media model is set for a type, pi-media sends each file of that type to the media model, also when the chat model can read the original. The chat model gets the text in place of the file. This applies to files in your messages, pasted images, and files that the agent reads.

### Set up a media model

1. Run `/media-models`.
2. Select the file type: Image, Audio or Document (PDF).
3. Select a model. The list shows the models that pi has credentials for. A model in the list can still be unable to read the file type. For a model that is not in the list, select `Type a model…` and type `provider/model-id`. pi must know the provider.
4. Select the API:
   - `openai-completions` sends the file to an OpenAI-compatible Chat Completions endpoint (`/chat/completions`). For audio, only the audio formats in the table above work.
   - `openai-transcriptions` sends audio to a speech-to-text endpoint (`/audio/transcriptions`). Use it for audio only. The service decides which audio formats it accepts.

pi-media saves the setting and uses it from the next message or read. To send files of a type directly again, select `Not set`. You do not have to change your chat model. `/media-models` needs the terminal UI. Without it, edit the [settings file](#settings).

### What you see for files in your messages

- While a media model works, the terminal UI shows a progress message, for example `Transcribing call.m4a with provider/model-id…`. Esc stops the current call and the calls for the remaining files in the message.
- The text shows after your message, collapsed. Ctrl+O expands it.
- If a call fails or you stop it, the chat model gets an error note in place of the text. The note names the media model, the file and the reason.
- Later turns and resumed sessions use the stored text or note. They do not call the media model again. To try again, send the file again.
- The footer shows the media models that are set, for example `media: image provider/model-id, audio provider/model-id`.

## Files the agent opens

The agent can open local files with the `read` tool. pi-media lets it also read audio, video and PDF files.

- If a media model is set for the file type, the agent gets the text or an error note. Each new read calls the media model again.
- If no media model is set, audio, video and PDF files go directly to the chat model, with the same format and model limits as files in messages. If the chat model cannot take the file, or the file is larger than the size limit, the agent gets a note and no content.
- Other files, and images without an image model, read as with pi's own `read` tool.

## Stored data

- pi stores the images that it attaches as part of the session.
- pi-media stores each audio, video and PDF file that has no media model in the session. It stores the file also when the chat model or the format does not let pi-media send it.
- A file for a media model goes to the provider that you select for that media model. pi-media stores the resulting text or error note in the session, not the original file.
- Later turns and resumed sessions use the stored files and text. If you change a file, send it again or ask the agent to read it again to use the new version.

## Settings

pi-media reads its settings from `~/.pi/agent/pi-media.json`. If you set `PI_CODING_AGENT_DIR`, it reads `$PI_CODING_AGENT_DIR/pi-media.json`. A missing file or setting gets the default.

| Setting | Default | Effect |
|---|---|---|
| `maxAttachmentBytes` | `20971520` (20 MiB) | Maximum size in bytes for files added by path, audio/video/PDF reads, and image reads through a media model. |
| `imageModel` | Not set | The media model for images. |
| `audioModel` | Not set | The media model for audio files. |
| `documentModel` | Not set | The media model for PDF files. |

A media model setting must have all of these fields:

| Field | Value |
|---|---|
| `provider` | The name of a provider that pi knows. |
| `id` | The model ID at that provider. |
| `api` | `openai-completions` or `openai-transcriptions`. |

Example, for a limit of 50 MiB:

```json
{
  "maxAttachmentBytes": 52428800
}
```

- After you edit the file by hand, run `/reload` or start pi again.
- pi-media ignores keys that it does not know.
- If the file is not valid JSON, is not a JSON object, or has a wrong value, pi-media does not load. pi shows an error that names the file and, for a wrong value, the setting.
- If pi does not know the provider of a media model, pi shows an error when the session starts, and pi-media is off for that session. To turn it on again, correct the setting with `/media-models`, or correct the file and run `/reload`.

## Troubleshooting and limits

- **Wait for the current response before you send a file for a media model.** If you send it while the agent works, the chat model can get the text in a turn of its own before your question.
- **The chat model's provider rejects a file.** If a direct attachment causes an error, it stays in the session and can make later requests fail too. Use `/tree` to go back to a point before the message or read, or switch to a chat model that accepts the file.
- **Skill and prompt template commands.** In a message that starts with `/skill:name` or a prompt template command (`/name`), audio, video and PDF files do not go directly to the chat model. Images and media model text work as usual.
- **Virtual models** (`pi-virtual`) do not get audio, video or PDF files directly. Images use pi's own image support, and media model text works as usual.
- **Another `read` tool.** If another extension also adds a `read` tool, pi uses the tool of the extension that loads first.

### Path details

- pi-media also finds `file://` URIs, for example `file:///Users/me/My%20File.pdf`.
- On Windows, it also finds paths that start with a drive (`C:\` or `C:/`), with `\\` for a network share, or with `.\`, `..\` or `~\`.
- pi-media ignores punctuation directly after a path. In `(see ./a.pdf).` it finds `./a.pdf`.
- A path without quotes or backslashes ends at the first space if its line has other text. In `see /Users/me/My File.png`, pi-media finds no file.
- On Windows, a path with an apostrophe in its file name does not work in single quotes. Use double quotes, or put the path alone on a line.

## Development

pi-media has no build step. pi loads the TypeScript files in `src/` directly. To run the format, lint, type and test checks, run `npm run check`. To fix the format, run `npm run format`.

## License

MIT
