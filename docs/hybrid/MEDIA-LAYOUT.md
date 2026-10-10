# Model-authored media composition

Hosts register attachments and pass a `ContentHost`. Models choose semantic layout using IDs; they cannot import components, supply CSS, sign URLs or fetch images themselves.

```json
{"engine":"v1","block":"media","attachments":["photo-a","photo-b"],"layout":"carousel","markdown":"## Compare the views\nSwipe through the host images.","placement":"left","mediaFraction":0.4}
```

`placement` accepts `left`, `right`, `above`, `below`. The first two place media beside the Markdown at container widths of at least 600px and stack in narrower containers. `mediaFraction` is bounded to 0.25–0.65. It applies to the media column, without changing the answer/runtime state. These fields survive schema-2 history restoration. Hosts may replace `AnswerView.renderMedia` and the Markdown renderer.

`layout` accepts `auto`, `hero`, `compare`, `grid`, `carousel`, `player`, `files`. Carousel has horizontal paging, previous/next controls, a page counter, image enlargement and readable alt text. Web uses scroll snap; React Native uses a horizontally paged ScrollView; Flutter uses PageView. Paging is local and never calls a model. Kit changes retain the page; removing pages clamps the current index. A restored history restores media identity/layout, not an ephemeral gallery page or modal.

Default count layout: one image is a hero, two side by side, three to six a grid, larger sequences a carousel, video a player, mixed files a file list. Explicit `carousel` also works for two images. ImageCompare is a paired comparison, not a drag-wipe widget. Registered Carousel/Gallery components can be used inside an A2UI surface as well.

Image enlargement uses a modal: web browser zoom, Flutter InteractiveViewer and RN iOS native zoom / Android explicit zoom buttons. Video captions and chapter times come from the host transcript. Chapter actions seek locally. Native transcripts are readable captions; the SDK does not claim OS caption-track-selection parity. Sound autoplay is off. DocumentPreview and Flutter Audio have FileCard fallbacks.

`allowMedia:false` blocks media carriers, embedded catalog media and Markdown attachment loading. Unknown IDs and denied resolver origins never become direct network URLs. The host owns response MIME verification, redirects, storage, download authentication and URL refresh. No attachment upload or generative-media service is built into Engine.

Try [the photo Showcase](http://127.0.0.1:5173/showcase.html?id=H-01). The examples are synthetic host assets, not model-generated photographs. Generation guidance includes these exact layout options and the target's supported components.
