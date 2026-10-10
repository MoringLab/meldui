import type { AnswerSession } from "@engine/core";
import type { AnswerBlock } from "@engine/protocol";
import React, {
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ContentProvider, MediaContent, useContentHost } from "./content.js";
import { SafeMarkdown } from "./markdown.js";
import { UISurface } from "./renderer.js";
import { SandboxView, type SandboxViewerRuntime } from "./sandbox.js";

export type MarkdownRendererProps = { text: string; streaming: boolean };
/** Hosts replace this to reuse their own Markdown pipeline (it must sanitize; see docs/hybrid). */
export type MarkdownRenderer = (props: MarkdownRendererProps) => ReactNode;
export type MediaBlockView = Extract<AnswerBlock, { kind: "media" }>;
export type AnswerLabels = {
  surface: string;
  reset: string;
  expand: string;
  close: string;
  viewAsText: string;
  viewAsInterface: string;
  incomplete: string;
  sandboxBlocked: string;
};
export const defaultAnswerLabels: AnswerLabels = {
  surface: "Interactive content",
  reset: "Reset",
  expand: "Expand",
  close: "Close",
  viewAsText: "View as text",
  viewAsInterface: "View interactive",
  incomplete: "Part of this content could not be shown.",
  sandboxBlocked: "Interactive content is not available here.",
};

/** Minimal built-in renderer: paragraphs and fenced code, always as text nodes (never markup). */
export const PlainMarkdown: MarkdownRenderer = ({ text }) => {
  const parts = text.split(/\n```[^\n]*\n([\s\S]*?)(?:\n```|$)/);
  return (
    <div className="ui-markdown">
      {parts.map((part, i) =>
        i % 2 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
          <pre key={i} className="ui-markdown-code">
            <code>{part}</code>
          </pre>
        ) : (
          part
            .split(/\n{2,}/)
            .filter((p) => p.trim())
            // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
            .map((p, j) => <p key={`${i}-${j}`}>{p}</p>)
        ),
      )}
    </div>
  );
};

export type AnswerViewProps = {
  session: AnswerSession;
  sandbox?: SandboxViewerRuntime;
  markdown?: MarkdownRenderer;
  /** Render a media block. Default: a plain list of attachment ids until the media components land. */
  renderMedia?: (block: MediaBlockView) => ReactNode;
  /** Host handler for the `expand` chrome action. Without it a modal dialog is used. */
  onExpand?: (surfaceId: string) => void;
  /** Cap the surface height with internal scroll; undefined grows with content. */
  maxSurfaceHeight?: number;
  /** Show the title / reset / expand / view-as-text bar. */
  chrome?: boolean;
  labels?: Partial<AnswerLabels>;
};

/** Ordered Markdown, surface and media blocks for one answer. */
export function AnswerView({
  session,
  sandbox,
  markdown = SafeMarkdown,
  renderMedia,
  onExpand,
  maxSurfaceHeight,
  chrome = true,
  labels: custom,
}: AnswerViewProps) {
  const contentHost = useContentHost();
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const Markdown = markdown;
  const labels = { ...defaultAnswerLabels, ...custom };
  const height = maxSurfaceHeight ?? session.policy.maxSurfaceHeight;
  return (
    <ContentProvider host={session.policy.allowMedia ? contentHost : undefined}>
      <div className="ui-answer">
        {state.blocks.map((block) => {
          switch (block.kind) {
            case "markdown":
              return (
                <div className="ui-answer-text" key={block.id} data-block={block.id}>
                  {<Markdown text={block.text} streaming={block.status === "streaming"} />}
                </div>
              );
            case "surface":
              return (
                <SurfaceFrame
                  key={block.id}
                  block={block}
                  session={session}
                  chrome={chrome}
                  labels={labels}
                  maxHeight={height}
                  onExpand={onExpand}
                />
              );
            case "media":
              return (
                <div
                  className={`ui-answer-media ui-composition ui-composition-${block.placement ?? "below"}`}
                  key={block.id}
                  data-block={block.id}
                  style={
                    {
                      "--media-fraction": `${(block.mediaFraction ?? 0.4) * 100}%`,
                    } as React.CSSProperties
                  }
                >
                  {block.markdown && (
                    <div className="ui-composition-text">
                      {<Markdown text={block.markdown} streaming={false} />}
                    </div>
                  )}
                  <div className="ui-composition-media">
                    {renderMedia?.(block) ?? (
                      <MediaContent
                        ids={block.attachmentIds}
                        layout={block.layout}
                        caption={block.caption}
                        alt={block.alt}
                      />
                    )}
                  </div>
                </div>
              );
            case "sandbox":
              if (sandbox?.verified && block.status !== "blocked")
                return <SandboxView key={block.id} block={block} provider={sandbox} />;
              return (
                <p className="ui-answer-blocked" key={block.id} role="note">
                  {labels.sandboxBlocked} {block.fallbackText}
                </p>
              );
          }
          return null;
        })}
      </div>
    </ContentProvider>
  );
}

function SurfaceFrame({
  block,
  session,
  chrome,
  labels,
  maxHeight,
  onExpand,
}: {
  block: Extract<AnswerBlock, { kind: "surface" }>;
  session: AnswerSession;
  chrome: boolean;
  labels: AnswerLabels;
  maxHeight?: number;
  onExpand?: (surfaceId: string) => void;
}) {
  const [asText, setAsText] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const summaryId = useId();
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (expanded && !el.open) el.showModal();
    if (!expanded && el.open) el.close();
  }, [expanded]);
  const title = block.title ?? labels.surface;
  const body = asText ? (
    <pre className="ui-frame-text">{block.fallbackText}</pre>
  ) : (
    <UISurface surfaceId={block.surfaceId} />
  );
  const iconButton = (label: string, onClick: () => void, glyph: string, pressed?: boolean) => (
    <button
      type="button"
      className="ui-frame-button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
  return (
    <figure
      className="ui-frame"
      data-block={block.id}
      data-status={block.status}
      aria-labelledby={titleId}
      aria-describedby={summaryId}
    >
      {chrome && (
        <figcaption className="ui-frame-bar">
          <span className="ui-frame-title" id={titleId}>
            {title}
          </span>
          <span className="ui-frame-actions">
            {iconButton(labels.reset, () => session.reset(block.surfaceId), "↺")}
            {iconButton(
              labels.expand,
              () => (onExpand ? onExpand(block.surfaceId) : setExpanded(true)),
              "⤢",
            )}
            {iconButton(
              asText ? labels.viewAsInterface : labels.viewAsText,
              () => setAsText(!asText),
              "T",
              asText,
            )}
          </span>
        </figcaption>
      )}
      <div
        className="ui-frame-body"
        style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
      >
        {body}
      </div>
      {block.status === "error" && (
        <p className="ui-frame-note" role="status">
          {labels.incomplete}
        </p>
      )}
      <p className="sr-only" id={summaryId}>
        {block.fallbackText}
      </p>
      <dialog
        ref={dialog}
        className="ui-frame-dialog"
        onClose={() => setExpanded(false)}
        aria-label={title}
      >
        {expanded && (
          <>
            <button
              type="button"
              className="ui-frame-button ui-frame-close"
              onClick={() => setExpanded(false)}
            >
              {labels.close}
            </button>
            <UISurface surfaceId={block.surfaceId} />
          </>
        )}
      </dialog>
    </figure>
  );
}
