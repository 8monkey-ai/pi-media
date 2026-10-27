# pi-media

pi-media is a [pi](https://github.com/earendil-works/pi) extension for local images, audio, video and PDF files. For example, ask what a screenshot shows or get a summary of a recording.

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

Type `@` to select a file, or type a path that starts with `/`, `~/`, `./` or `../`. You can also paste an image with Ctrl+V (Alt+V on Windows and WSL), or drag a file into a terminal that inserts its path. Put a path with spaces in quotes, or alone on a line.

If pi-media skips a file, the chat model receives only its path. Media model failures give an error note instead.

## Supported files

These formats can go directly to your chat model:

| Kind | Formats |
|---|---|
| Image | PNG, JPEG, GIF, WebP, BMP |
| Audio | WAV, MP3, AIFF, AAC, Ogg, FLAC, M4A |
| Video | MP4, MPEG, WebM |
| Document | PDF |

- **Images** go through pi's own image support. Animated PNG, HEIC and HEIF are not supported.
- **Audio, video and PDF files** go directly only when the chat model uses the `openai-completions` API in pi, and its provider and model accept the format.

## Media models (optional)

Your chat model is the model that you select with `/model`. Set a media model for file types that your chat model cannot read, or to use text instead of the original file. pi-media asks the media model for:

- Image: a description and all visible text.
- Audio: a transcript.
- PDF: the text, with a description of each chart and image.

When a media model is set for a type, its text replaces each file of that type, even when the chat model can read the original. Video has no media model.

### Set up a media model

1. Run `/media-models`.
2. Select Image, Audio or Document (PDF).
3. Select a model that supports the file type.
4. Select the API:
   - `openai-completions` uses an OpenAI-compatible `/chat/completions` endpoint.
   - `openai-transcriptions` uses an `/audio/transcriptions` endpoint, for audio only.

To send files of a type directly again, select `Not set`.

### Results and errors

- For files in your message, Esc stops the current media model call and the calls for the remaining files.
- The text shows collapsed after your message. Ctrl+O expands it.
- If a call fails or you stop it, the chat model gets an error note with the reason. To try again, send the file again.
- Wait for the current response before you send a file for a media model. Otherwise the chat model can get the text before your question.

## Files the agent reads

The agent can use `read` for images, audio, video and PDF files. A media model set for the type returns text or an error note, and each new read calls it again. Without one, pi handles images and pi-media sends supported audio, video and PDF files directly. Files above the pi-media size limit and unsupported direct reads return a note without the contents.

## Size limit

The default limit is 20 MiB for files added by path, audio/video/PDF reads, and image reads through a media model. To change it, set `maxAttachmentBytes` in the [settings file](#settings):

```json
{
  "maxAttachmentBytes": 52428800
}
```

## Settings

The settings file is `~/.pi/agent/pi-media.json`, or `$PI_CODING_AGENT_DIR/pi-media.json` if you set `PI_CODING_AGENT_DIR`. `/media-models` writes to it. Without an interactive UI, edit the file.

To set a media model by hand, add `imageModel`, `audioModel` or `documentModel` as an object with `provider` (a provider configured in pi), `id` (the model ID at that provider) and `api` (see [Set up a media model](#set-up-a-media-model)).

After you edit the file, run `/reload` or start pi again. If the file is not valid JSON or has a wrong value, pi-media does not load. If a media model uses a provider that is not configured in pi, pi-media is off for the session. Correct the setting with `/media-models`, or correct the file and run `/reload`.

## Stored data

- The session stores images sent to the chat model, and each audio, video and PDF file without a media model, even when the chat model cannot accept it.
- A file for a media model goes to that model's provider. The session stores the text or error note, not the file.
- Later turns and resumed sessions use the stored data. If you change a file, send it again or ask the agent to read it again.

## Limits

- **A direct attachment that the chat model's provider rejects** stays in the session and can make later requests fail. Use `/tree` to go back to before the message or read, or switch to a chat model that accepts the file.
- **Skill and prompt template commands** (`/skill:name`, `/name`) and **virtual models** (`pi-virtual`) do not send audio, video or PDF files directly. Images and media model text work as usual.
- **Another `read` tool:** if another extension also adds one, pi uses the tool of the extension that loads first.

## License

MIT
