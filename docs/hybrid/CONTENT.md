# Safe Markdown and host media

The built-in `AnswerView` renders GFM, code and math, and routes attachments through `ContentHost`. `Markdown` also works as a catalog component. `AnswerView.markdown` (Flutter `markdown`) and component registries accept a host renderer.

```tsx
import { AttachmentRegistry } from '@engine/core';
import { UIProvider, AnswerView, createUIRuntime } from '@engine/renderer-react';

const attachments = new AttachmentRegistry();
attachments.attach({ file: { name: 'photo.png', type: 'image/png', size: 2048 },
  id: 'photo', meta: { alt: 'Host-provided photo' } });
const runtime = createUIRuntime({ attachments });
const content = {
  attachments,
  policy: { origins: ['https://media.your-service.example'] },
  resolver: {
    resolve: async (id, purpose, signal) => hostResolve(id, purpose, signal),
    open: async id => hostOpen(id),
    download: async id => hostDownload(id),
  },
};
// Use the same `content` when the kit changes; the runtime/data stay intact.
<UIProvider runtime={runtime} kit={kit} content={content}>
  <AnswerView session={session} />
</UIProvider>;
```

The host's resolver returns `{url, mime, expiresAt?}`. No key or signing token goes into model-visible attachment views. The default URI scheme is HTTPS; exact origins must be configured by the host. The localhost lab explicitly permits HTTP to its loopback attachment fixture server. Host open/download callbacks receive IDs; they own authentication, confirmation, download response headers and real storage. A filename, transcript or caption never invokes an action.

The model references `![alt](attachment:photo)`, `[report](attachment:report)` or a media block with `attachments: [id]`. Invalid IDs render an unavailable FileCard and produce diagnostics. Links to HTTPS/mailto have no built-in navigation; `openLink` is called only under host policy. Signed query strings are redacted in serialized histories. Reattach host metadata to a restored runtime; private URL records are intentionally absent from history.

Catalog content includes Image, Gallery, Carousel, MediaGrid, ImageCompare, ImageAnnotations, Video, Audio, FileCard, DocumentPreview and Markdown. Compare currently presents two images side by side. Annotations use host-supplied region IDs; vision remains opt-in and is not enabled by displaying an image. RN/Flutter supply textual region alternatives. DocumentPreview falls back to FileCard; Flutter Audio also uses FileCard. Rich custom viewers/player controls can be registered by the host. Default muted and audible autoplay are both off; playback starts with user interaction.

There is no raw-HTML formatting opt-in in this release. Raw markup is stripped from prose, while fenced code examples remain literal. On native, images are removed/replaced before the Markdown library can load them. Transcripts supply video captions on web and readable alternatives on native. Missing captions are explicitly identified rather than invented. Native player caption tracks, chapter seek controls, zoom and a scrubbed before/after comparison are remaining extensions; the side-by-side/seek-property baseline is implemented.

Try `/eval.html?fixture=media-catalog&width=480` for the host fixture, or select “첨부파일 예제” in the web lab. The media assets in `fixtures/media/assets` are synthetic test fixtures, not model-generated attachments or real user uploads.

Preview gaps: `allowMedia:false` is currently enforced for explicit media carrier blocks, with full embedded Markdown/surface media gating still open. The RN native Markdown library also has a recorded theme-change contrast failure despite functional layout/selection checks passing; use a trusted host replacement for production theming until that gate is resolved. Details and the failing screenshot are in [M5](../verification/phase2/M5.md).
