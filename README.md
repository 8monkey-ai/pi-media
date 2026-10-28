# pi-media

Attach local images, audio, video and PDFs to your [pi](https://github.com/earendil-works/pi) conversations by including their paths in your messages. The agent can also open media files with `read`.

## Install

```bash
pi install npm:@8monkey/pi-media
```

You need pi and Node 22.19 or later.

## Examples

```
what is in this screenshot? @screen.png
summarize this recording: ~/Downloads/standup.mp3
compare @"Q3 report.pdf" with ./q4-report.pdf
```

Type `@` to pick a file, or enter a path starting with `/`, `~/`, `./` or `../`. Put paths with spaces in quotes.

## Send files to your chat model

By default, pi-media sends the original file to your chat model.

- Images use pi's own image support.
- Audio, video and PDF files work only when the chat model uses the `openai-completions` API in pi, and the provider and model accept the format.

pi-media can send these formats. Your model may accept only some of them.

| Type | Formats |
|---|---|
| Image | PNG (not animated), JPEG, GIF, WebP, BMP |
| Audio | WAV, MP3, AIFF, AAC, Ogg, FLAC, M4A |
| Video | MP4, MPEG, WebM |
| Document | PDF |

## Use a media model

A media model converts files to text, so you can use them with a chat model that cannot read the originals:

- Image: a description and the visible text
- Audio: a transcript
- PDF: the text, with descriptions of images and charts

Run `/media-models`, choose Image, Audio or Document (PDF), and pick a model that supports that type. Its provider must already be configured in pi and offer an OpenAI-compatible API.

For the API, choose `openai-completions` for chat models or `openai-transcriptions` for speech-to-text models. If the model is not in the list, choose `Type a model…` and enter `provider/model-id`.

When set, the media model handles every file of its type, and your chat model gets only the text. Video has no media model.

Wait for the current response to finish before you send a file for a media model. Otherwise the text can reach the chat model before your question.

## Size limit

Files you add by path can be up to 20 MiB. To change the limit, add or update `maxAttachmentBytes` in `~/.pi/agent/pi-media.json`, keep any other settings in the file, then run `/reload`. This example sets 50 MiB:

```json
{ "maxAttachmentBytes": 52428800 }
```

## Privacy

The chat model's provider receives original attachments, and the session keeps them even if they never reach the model. When a media model handles a file, its provider receives the file, and the session stores the returned text or error instead.

## Troubleshooting

- **The model gets only the path.** Check the file path, size, format and [model support](#send-files-to-your-chat-model).
- **Requests fail after you add a file.** If the provider rejects an attachment, the attachment stays in the session and can make later requests fail. Use `/tree` to go back to before the file was added or read, or switch to a model that accepts it.

## License

MIT
