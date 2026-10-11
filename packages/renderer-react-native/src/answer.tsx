import type { AnswerSession, CitationSource, CitationView } from "@engine/core";
import type { AnswerBlock } from "@engine/protocol";
import React, { type ReactNode, useMemo, useState, useSyncExternalStore } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { ContentProvider, MediaContent, useContentHost } from "./content.js";
import { CitationProvider, SafeMarkdown } from "./markdown.js";
import { UISurface, useUI } from "./renderer.js";

export type MarkdownRenderer = (props: { text: string; streaming: boolean }) => ReactNode;
export type MediaBlockView = Extract<AnswerBlock, { kind: "media" }>;
export type SurfaceBlockView = Extract<AnswerBlock, { kind: "surface" }>;
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

export { SafeMarkdown as PlainMarkdown } from "./markdown.js";

export type AnswerViewProps = {
  session: AnswerSession;
  markdown?: MarkdownRenderer;
  renderMedia?: (block: MediaBlockView) => ReactNode;
  /**
   * Host frame for a surface (its own toolbar, card, height policy). Draw the contents with
   * `<UISurface surfaceId={block.surfaceId} />`; `session.reset(id)` and `block.fallbackText`
   * provide reset and the text view. Without it the built-in frame is used.
   */
  renderSurface?: (block: SurfaceBlockView, session: AnswerSession) => ReactNode;
  renderLayout?: (children: ReactNode) => ReactNode;
  /** Resolves inline citation ids ("[w1]") in Markdown; unresolved ids are dropped. */
  citations?: CitationSource;
  /** Host presentation of the sources cited by one Markdown block. */
  renderCitations?: (views: CitationView[]) => ReactNode;
  /** Host handler for `expand`; without it a full-screen Modal is shown. */
  onExpand?: (surfaceId: string) => void;
  maxSurfaceHeight?: number;
  chrome?: boolean;
  labels?: Partial<AnswerLabels>;
};

/** Ordered Markdown, surface and media blocks. The host list owns scrolling. */
export function AnswerView({
  session,
  markdown = SafeMarkdown,
  renderMedia,
  renderSurface,
  renderLayout,
  citations,
  renderCitations,
  onExpand,
  maxSurfaceHeight,
  chrome = true,
  labels: custom,
}: AnswerViewProps) {
  const contentHost = useContentHost();
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [width, setWidth] = useState(0);
  const { kit, mode } = useUI();
  const t = kit.tokens[mode];
  const labels = { ...defaultAnswerLabels, ...custom };
  const height = maxSurfaceHeight ?? session.policy.maxSurfaceHeight;
  const Markdown = markdown;
  const rendered = (
    <ContentProvider host={session.policy.allowMedia ? contentHost : undefined}>
      <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ gap: 16 }}>
        {state.blocks.map((block) => {
          switch (block.kind) {
            case "markdown":
              return (
                <Markdown
                  key={block.id}
                  text={block.text}
                  streaming={block.status === "streaming"}
                />
              );
            case "surface":
              if (renderSurface)
                return (
                  <React.Fragment key={block.id}>{renderSurface(block, session)}</React.Fragment>
                );
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
                <View
                  key={block.id}
                  style={{
                    gap: 16,
                    flexDirection:
                      width >= 600 && ["left", "right"].includes(block.placement ?? "below")
                        ? block.placement === "left"
                          ? "row-reverse"
                          : "row"
                        : block.placement === "above" || block.placement === "left"
                          ? "column-reverse"
                          : "column",
                  }}
                >
                  {block.markdown && (
                    <View
                      style={{
                        flex:
                          width >= 600 && ["left", "right"].includes(block.placement ?? "below")
                            ? 1 - (block.mediaFraction ?? 0.4)
                            : undefined,
                        minWidth: 0,
                      }}
                    >
                      <Markdown text={block.markdown} streaming={false} />
                    </View>
                  )}
                  <View
                    style={{
                      flex:
                        width >= 600 && ["left", "right"].includes(block.placement ?? "below")
                          ? (block.mediaFraction ?? 0.4)
                          : undefined,
                      minWidth: 0,
                    }}
                  >
                    {renderMedia?.(block) ?? (
                      <MediaContent
                        ids={block.attachmentIds}
                        layout={block.layout}
                        caption={block.caption}
                        alt={block.alt}
                      />
                    )}
                  </View>
                </View>
              );
            default:
              return (
                <Text key={block.id} accessibilityRole="alert" style={{ color: t.muted }}>
                  {labels.sandboxBlocked} {block.fallbackText}
                </Text>
              );
          }
        })}
      </View>
    </ContentProvider>
  );
  const cited = useMemo(
    () => ({ source: citations, render: renderCitations }),
    [citations, renderCitations],
  );
  return (
    <CitationProvider value={cited}>
      {renderLayout ? renderLayout(rendered) : rendered}
    </CitationProvider>
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
  const { kit, mode } = useUI();
  const t = kit.tokens[mode];
  const [asText, setAsText] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const title = block.title ?? labels.surface;
  const iconButton = (label: string, onPress: () => void, glyph: string, selected?: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minWidth: 48,
        minHeight: 48,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        backgroundColor: selected ? t.surface : "transparent",
      }}
    >
      <Text style={{ color: t.foreground, fontSize: 18 }}>{glyph}</Text>
    </Pressable>
  );
  const body = asText ? (
    <Text selectable style={{ color: t.foreground, fontSize: 16, lineHeight: 25 }}>
      {block.fallbackText}
    </Text>
  ) : (
    <UISurface surfaceId={block.surfaceId} />
  );
  return (
    <View
      accessible={false}
      style={{
        borderWidth: 1,
        borderColor: t.border,
        borderRadius: kit.tokens.radius,
        backgroundColor: t.background,
      }}
    >
      {chrome && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingLeft: 14,
            paddingRight: 4,
            borderBottomWidth: 1,
            borderBottomColor: t.border,
          }}
        >
          <Text
            numberOfLines={1}
            accessibilityRole="header"
            style={{ color: t.muted, fontSize: 13, flexShrink: 1 }}
          >
            {title}
          </Text>
          <View style={{ flexDirection: "row" }}>
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
          </View>
        </View>
      )}
      {maxHeight ? (
        <ScrollView
          nestedScrollEnabled
          style={{ maxHeight }}
          contentContainerStyle={{ padding: 16 }}
        >
          {body}
        </ScrollView>
      ) : (
        <View style={{ padding: 16 }}>{body}</View>
      )}
      {block.status === "error" && (
        <Text
          accessibilityRole="alert"
          style={{ color: t.muted, fontSize: 13, paddingHorizontal: 14, paddingBottom: 8 }}
        >
          {labels.incomplete}
        </Text>
      )}
      <Modal visible={expanded} animationType="slide" onRequestClose={() => setExpanded(false)}>
        <View style={{ flex: 1, backgroundColor: t.background }}>
          <View style={{ alignItems: "flex-end", padding: 8 }}>
            {iconButton(labels.close, () => setExpanded(false), "✕")}
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <UISurface surfaceId={block.surfaceId} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
