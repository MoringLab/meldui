import type { AnswerSession } from "@engine/core";
import type { AnswerBlock } from "@engine/protocol";
import React, { type ReactNode, useState, useSyncExternalStore } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { UISurface, useUI } from "./renderer.js";

export type MarkdownRenderer = (props: { text: string; streaming: boolean }) => ReactNode;
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

/** Minimal built-in renderer: paragraphs and fenced code as native Text (never markup). */
export const PlainMarkdown: MarkdownRenderer = ({ text }) => {
  const { kit, mode } = useUI();
  const t = kit.tokens[mode];
  const parts = text.split(/\n```[^\n]*\n([\s\S]*?)(?:\n```|$)/);
  return (
    <View style={{ gap: 10 }}>
      {parts.map((part, i) =>
        i % 2 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
          <ScrollView
            key={i}
            horizontal
            style={{
              backgroundColor: t.surface,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: t.border,
            }}
          >
            <Text
              style={{ fontFamily: "monospace", color: t.foreground, padding: 12, fontSize: 14 }}
            >
              {part}
            </Text>
          </ScrollView>
        ) : (
          part
            .split(/\n{2,}/)
            .filter((p) => p.trim())
            .map((p, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
              <Text key={`${i}-${j}`} style={{ color: t.foreground, fontSize: 16, lineHeight: 25 }}>
                {p}
              </Text>
            ))
        ),
      )}
    </View>
  );
};

export type AnswerViewProps = {
  session: AnswerSession;
  markdown?: MarkdownRenderer;
  renderMedia?: (block: MediaBlockView) => ReactNode;
  /** Host handler for `expand`; without it a full-screen Modal is shown. */
  onExpand?: (surfaceId: string) => void;
  maxSurfaceHeight?: number;
  chrome?: boolean;
  labels?: Partial<AnswerLabels>;
};

/** Ordered Markdown, surface and media blocks. The host list owns scrolling. */
export function AnswerView({
  session,
  markdown = PlainMarkdown,
  renderMedia,
  onExpand,
  maxSurfaceHeight,
  chrome = true,
  labels: custom,
}: AnswerViewProps) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const { kit, mode } = useUI();
  const t = kit.tokens[mode];
  const labels = { ...defaultAnswerLabels, ...custom };
  const height = maxSurfaceHeight ?? session.policy.maxSurfaceHeight;
  const Markdown = markdown;
  return (
    <View style={{ gap: 16 }}>
      {state.blocks.map((block) => {
        switch (block.kind) {
          case "markdown":
            return (
              <Markdown key={block.id} text={block.text} streaming={block.status === "streaming"} />
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
              <View key={block.id}>
                {renderMedia?.(block) ?? (
                  <Text style={{ color: t.muted }}>{block.attachmentIds.join(", ")}</Text>
                )}
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
