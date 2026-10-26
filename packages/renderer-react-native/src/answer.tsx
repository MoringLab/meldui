import type { AnswerSession, CitationSource, CitationView } from "@engine/core";
import type { AnswerBlock } from "@engine/protocol";
import React, { type ReactNode, useMemo, useState, useSyncExternalStore } from "react";
import { Animated, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { ContentProvider, MediaContent, useContentHost } from "./content.js";
import { CitationProvider, SafeMarkdown } from "./markdown.js";
import { animateTo, UISurface, useMotion, useUI } from "./renderer.js";

export type MarkdownRenderer = (props: { text: string; streaming: boolean }) => ReactNode;
export type MediaBlockView = Extract<AnswerBlock, { kind: "media" }>;
export type SurfaceBlockView = Extract<AnswerBlock, { kind: "surface" }>;
export type SandboxBlockView = Extract<AnswerBlock, { kind: "sandbox" }>;
export type AnswerLabels = {
  surface: string;
  reset: string;
  expand: string;
  close: string;
  viewAsText: string;
  viewAsInterface: string;
  incomplete: string;
  sandboxBlocked: string;
  /** A sandbox still streaming in ("building"). */
  sandboxBuilding: string;
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
  sandboxBuilding: "Building interactive content…",
};

/** Korean chrome words for hosts: `labels={KO_ANSWER_LABELS}`. */
export const KO_ANSWER_LABELS: AnswerLabels = {
  surface: "인터랙티브 콘텐츠",
  reset: "처음으로",
  expand: "크게 보기",
  close: "닫기",
  viewAsText: "글로 보기",
  viewAsInterface: "화면으로 보기",
  incomplete: "일부 내용을 표시하지 못했어요.",
  sandboxBlocked: "여기서는 이 콘텐츠를 열 수 없어요.",
  sandboxBuilding: "화면을 만드는 중…",
};

/**
 * A block that appears after the answer is on screen fades in and rises by the kit's
 * `motion.enterOffset` (UI thread). Blocks present at first render do not animate, so
 * restored history and re-renders stay still.
 */
function Enter({ children, animate }: { children: ReactNode; animate: boolean }) {
  const motion = useMotion();
  const offset = animate ? motion.enterOffset : 0;
  const run = animate && motion.durationMs > 0;
  const value = React.useRef(new Animated.Value(run ? 0 : 1)).current;
  // biome-ignore lint/correctness/useExhaustiveDependencies: enters once, on mount
  React.useEffect(() => {
    if (run) animateTo(value, 1, motion, { useNativeDriver: true, minDurationMs: 180 });
  }, []);
  if (!run) return <>{children}</>;
  return (
    <Animated.View
      style={{
        opacity: value,
        transform: [
          { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

export { SafeMarkdown as PlainMarkdown } from "./markdown.js";

/** Narrowest answer width (pt) at which a media block sits beside its Markdown. */
const SIDE_BY_SIDE_MIN = 300;

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
  /**
   * Host view for a sandbox (HTML/JS) block, e.g. an isolated web view built with
   * `sandboxDocument` from @engine/core. Without it the block shows its fallback text.
   */
  renderSandbox?: (block: SandboxBlockView) => ReactNode;
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
  renderSandbox,
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
  // Ids rendered on the first pass: those are history and never animate in.
  const initial = React.useRef<Set<string> | null>(null);
  if (initial.current === null) initial.current = new Set(state.blocks.map((b) => b.id));
  const height = maxSurfaceHeight ?? session.policy.maxSurfaceHeight;
  const Markdown = markdown;
  const rendered = (
    <ContentProvider host={session.policy.allowMedia ? contentHost : undefined}>
      <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ gap: 16 }}>
        {state.blocks.map((block) => (
          <Enter key={block.id} animate={!initial.current?.has(block.id)}>
            {renderBlock(block)}
          </Enter>
        ))}
      </View>
    </ContentProvider>
  );
  function renderBlock(block: (typeof state.blocks)[number]): ReactNode {
    switch (block.kind) {
      case "markdown":
        return (
          <Markdown key={block.id} text={block.text} streaming={block.status === "streaming"} />
        );
      case "surface":
        if (renderSurface)
          return <React.Fragment key={block.id}>{renderSurface(block, session)}</React.Fragment>;
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
      case "media": {
        // Beside the text from phone widths up: a picture next to a short explanation
        // reads well at 0.35–0.45 of ~340 pt; narrower screens stack.
        const beside =
          !!block.markdown &&
          width >= SIDE_BY_SIDE_MIN &&
          ["left", "right"].includes(block.placement ?? "below");
        return (
          <View
            key={block.id}
            style={{
              gap: beside ? 12 : 16,
              alignItems: beside ? "flex-start" : undefined,
              flexDirection: beside
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
                  flex: beside ? 1 - (block.mediaFraction ?? 0.4) : undefined,
                  minWidth: 0,
                }}
              >
                <Markdown text={block.markdown} streaming={false} />
              </View>
            )}
            <View
              style={{
                flex: beside ? (block.mediaFraction ?? 0.4) : undefined,
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
      }
      default:
        // A sandbox (HTML/JS) block: drawn by the host's isolated web view when it has one.
        // While its declaration streams ("building") the host may draw its own placeholder.
        if (
          renderSandbox &&
          (block.status === "building" || (block.status === "complete" && block.source))
        )
          return <React.Fragment key={block.id}>{renderSandbox(block)}</React.Fragment>;
        if (block.status === "building")
          return (
            <Text key={block.id} accessibilityLiveRegion="polite" style={{ color: t.muted }}>
              {labels.sandboxBuilding}
            </Text>
          );
        return (
          <Text key={block.id} accessibilityRole="alert" style={{ color: t.muted }}>
            {labels.sandboxBlocked} {block.fallbackText}
          </Text>
        );
    }
  }
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
