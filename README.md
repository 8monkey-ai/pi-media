# pi-media

pi-media is a [pi](https://github.com/earendil-works/pi) extension for local images, audio, video and PDF files. Write a file path in your message, and pi-media gives the file to your chat model, the model that you select with `/model`, in one of two ways:

- It sends the original file to your chat model. The [direct-attachment requirements](#send-files-directly) apply.
- A separate media model converts the image, audio or PDF file to text, and your chat model gets the text.

## Install

```bash
pi install npm:@8monkey/pi-media
```

pi-media needs pi and Node 22.19 or later.

## Use

Put one or more file paths in your message:

```
what is in this screenshot? @screen.png
summarize this recording: ~/Downloads/standup.mp3
compare @"Q3 report.pdf" with ./q4-report.pdf
```

Type `@` to select a file, or type a path that starts with `/`, `~/`, `./` or `../`. You can also paste an image with Ctrl+V (Alt+V on Windows and WSL), or drag a file into a terminal that inserts its path. Put a path with spaces in quotes, or alone on a line.

If a file is missing, has an unsupported format or is over the [size limit](#settings), the chat model gets only the path, not the file content.

### Send files directly

Without a media model for the file type, pi-media sends the original file to your chat model:

- Images use pi's own image support.
- Audio, video and PDF files go only to a chat model that uses the `openai-completions` API in pi (`model.api`). The provider and the model must also accept the format.

| Kind | Formats |
|---|---|
| Image | PNG, JPEG, GIF, WebP, BMP |
| Audio | WAV, MP3, AIFF, AAC, Ogg, FLAC, M4A |
| Video | MP4, MPEG, WebM |
| Document | PDF |

pi-media does not support animated PNG, HEIC or HEIF files.

### Use a media model

Use a media model when your chat model cannot read a file type, or when you prefer text. The media model converts files to text for your chat model:

- Image: a description and all visible text.
- Audio: a transcript.
- PDF: the text, with a description of each chart and image.

Video has no media model. When you set a media model for a type, its text replaces every file of that type, even when the chat model can accept the original.

To set a media model:

1. Configure the provider in pi.
2. Run `/media-models`.
3. Select Image, Audio or Document (PDF).
4. Select a model that supports the file type. The list does not filter models by file support. To use a model that is not in the list, select `Type a model…` and type `provider/model-id`.
5. Select the API:
   - `openai-completions` uses an OpenAI-compatible `/chat/completions` endpoint.
   - `openai-transcriptions` uses an `/audio/transcriptions` endpoint, for audio only.

To stop converting that type to text, select `Not set`. The [direct-attachment requirements](#send-files-directly) still apply.

The text shows collapsed after your message. Ctrl+O expands it. In the terminal UI, Esc stops the current conversion and the conversions for the remaining files in your message. If a conversion fails or you stop it, the chat model gets a note with the reason instead of the original file. To try again, send the file again.

Wait for the current response to finish before you send a file for a media model. Otherwise the chat model can get the text before your question.

### Files the agent reads

The agent can open images, audio, video and PDF files with the `read` tool. If you set a media model for the file type, the agent gets the media model's text. Otherwise, the original file goes to your chat model, and the [direct-attachment requirements](#send-files-directly) apply.

## Settings

The settings file is `~/.pi/agent/pi-media.json`, or `$PI_CODING_AGENT_DIR/pi-media.json` if you set `PI_CODING_AGENT_DIR`. `/media-models` writes to this file, and its changes apply immediately. Without the interactive terminal UI, edit the file.

This example sets a 50 MiB size limit and an audio model. Replace `<provider-name>` with a provider configured in pi, and `<model-id>` with its model ID at that provider.

```json
{
  "maxAttachmentBytes": 52428800,
  "audioModel": {
    "provider": "<provider-name>",
    "id": "<model-id>",
    "api": "openai-transcriptions"
  }
}
```

- `maxAttachmentBytes`: the size limit in bytes. The default is 20 MiB. The limit applies to files that you add by path in your message, audio, video and PDF files that `read` opens, and images that `read` sends to a media model. A file in your message that is over the limit stays a path only. For a file over the limit, `read` reports the limit and returns no file content.
- `imageModel`, `audioModel`, `documentModel`: the media model for each type, with these fields:
  - `provider`: a provider configured in pi.
  - `id`: the model ID at that provider.
  - `api`: `openai-completions` or `openai-transcriptions`.

After you edit the file, run `/reload` or start pi again. If the file is not valid JSON or has a wrong value, pi-media does not load. If a media model uses a provider that is not configured in pi, pi-media is off for the session. Correct the setting with `/media-models`, or correct the file and run `/reload`.

## Data and troubleshooting

### Stored data

- The session stores images sent to your chat model, and audio, video and PDF files without a media model, even when the chat model cannot accept them.
- A media model's provider receives the file. The session stores the text or error note, not the file.
- Later turns and resumed sessions use the stored data. If you change a file, send it again or ask the agent to read it again.

### Rejected files

A file that the chat model's provider rejects stays in the session and can make later requests fail. Use `/tree` to go back to before the message or read, or switch to a chat model that accepts the file.

### Other limits

- Skill and prompt template commands (`/skill:name`, `/name`) and virtual models (`pi-virtual`) do not send audio, video or PDF files directly. Images and media model text work.
- Some chat models need an assistant message after tool results (the `requiresAssistantAfterToolResult` compat setting in pi). These models do not get audio, video or PDF files from `read`.
- If another extension also adds a `read` tool, pi uses the tool of the extension that loads first.

## License

MIT
