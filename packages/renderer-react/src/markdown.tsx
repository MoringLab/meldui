// biome-ignore-all lint/suspicious/noArrayIndexKey: append-only Markdown segments retain their order during streaming
import { attachmentIdFrom, markdownDestination, prepareMarkdown } from "@engine/core";
import React from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { AttachmentMedia, openContentLink, useContentHost } from "./content.js";
/** No rehype-raw. All HTML is discarded; URLs have no network/navigation side effect by default. */
export function SafeMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const host = useContentHost();
  let parts: ReturnType<typeof prepareMarkdown>;
  try {
    parts = prepareMarkdown(text);
  } catch {
    return <p role="status">Markdown is too large to display.</p>;
  }
  return (
    <div className="ui-markdown" data-streaming={streaming}>
      {parts.map((part, i) =>
        "attachmentId" in part ? (
          <AttachmentMedia key={`image-${i}`} id={part.attachmentId} alt={part.alt} />
        ) : (
          <ReactMarkdown
            key={`text-${i}`}
            skipHtml
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[
              [rehypeKatex, { trust: false, throwOnError: false, maxExpand: 100, maxSize: 10 }],
              rehypeHighlight,
            ]}
            urlTransform={(value) => markdownDestination(value) ?? ""}
            components={{
              li: ({ children, className }) => (
                <li className={className}>
                  {className?.includes("task-list-item") ? (
                    // biome-ignore lint/a11y/noLabelWithoutControl: remark-gfm supplies the disabled checkbox in these children.
                    <label>{children}</label>
                  ) : (
                    children
                  )}
                </li>
              ),
              a: ({ href, children }) => (
                <button
                  type="button"
                  className="ui-markdown-link"
                  onClick={() =>
                    href &&
                    void openContentLink(host, href).catch(() =>
                      host?.onDiagnostic?.("LINK_BLOCKED", attachmentIdFrom(href) ?? "external"),
                    )
                  }
                >
                  {children}
                </button>
              ),
              table: ({ children }) => (
                <div className="ui-table-scroll">
                  <table>{children}</table>
                </div>
              ),
              img: ({ alt }) => <span>{alt || "Image unavailable"}</span>,
            }}
          >
            {part.markdown}
          </ReactMarkdown>
        ),
      )}
    </div>
  );
}
