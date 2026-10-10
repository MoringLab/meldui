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

Raw HTML is stripped by default. `ContentHost.policy.formattingHtml:true` (Flutter `ContentHost.formattingHtml`) recognizes only attribute-free, text-only b/strong/i/em/s/del/code pairs; it never enables arbitrary HTML rendering. Code fences and inline code remain literal. Web uses patched KaTeX directly with trust disabled; native code highlighting and host transcript/chapter controls are now implemented. Native transcripts are readable caption alternatives, not OS caption-track-selection parity.

Image enlargement and paged/swipe galleries work on all three platforms. Side-by-side ImageCompare remains a paired comparison rather than a wipe control. Media next to Markdown is described in [the composition contract](MEDIA-LAYOUT.md). `allowMedia:false` now gates catalog and Markdown attachment loading as well as explicit carrier blocks. RN Markdown remounts its native renderer on theme/kit changes to refresh cached styling; device screenshots retain the actual observed colors.

The synthetic fixture is available at `/eval.html?fixture=media-catalog&width=480`. Host transport owns MIME/redirect checks and real uploads/storage. Platform fallback limits, generation quality and new dated verification are in [STATUS](../STATUS.md).
