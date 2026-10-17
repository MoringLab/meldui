// biome-ignore-all lint/suspicious/noArrayIndexKey: append-only Markdown segments retain their order during streaming
import {
  type CitationSource,
  type CitationView,
  entityLinks,
  extractCitations,
  normalizeMathDelimiters,
  prepareMarkdown,
  splitMarkdownBlocks,
} from "@engine/core";
import { resolveTypography } from "@engine/kit-spec";
import React, { createContext, memo, type ReactNode, useContext, useMemo, useState } from "react";
import { Platform, Text, View } from "react-native";
import { EnrichedMarkdownText } from "react-native-enriched-markdown";
import { AttachmentMedia, openContentLink, useContentHost } from "./content.js";
import { withAlpha } from "./interactive.js";
import { useMotion, useUI } from "./renderer.js";

/**
 * Links a host handles itself (an entity's [[name]], app routes): return true when handled,
 * so the link is not opened as a web page.
 */
export const LinkHandlerContext = createContext<((url: string) => boolean) | null>(null);
export type CitationOptions = {
  /** Resolves cited ids; without it citation markers stay ordinary text. */
  source?: CitationSource;
  /** Host presentation of one block's cited sources (default: small pills). */
  render?: (views: CitationView[]) => ReactNode;
};
const CitationContext = createContext<CitationOptions>({});
/** Citations for Markdown rendered below it (AnswerView sets this from its props). */
export function CitationProvider({
  value,
  children,
}: {
  value: CitationOptions;
  children: ReactNode;
}) {
  return <CitationContext.Provider value={value}>{children}</CitationContext.Provider>;
}

function DefaultCitations({ views }: { views: CitationView[] }) {
  const { kit, mode } = useUI();
  const t = kit.tokens[mode];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {views.map((v) => (
        <View
          key={v.id}
          accessibilityLabel={`${v.site ?? ""} ${v.title}`.trim()}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            maxWidth: 200,
            paddingVertical: 4,
            paddingHorizontal: 10,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: t.border,
            backgroundColor: t.surface,
          }}
        >
          <Text numberOfLines={1} style={{ color: t.muted, fontSize: 12, flexShrink: 1 }}>
            {v.site ? `${v.site} · ${v.title}` : v.title}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The mdast boundary removes every image URL and raw HTML before native parsing. Text is
 * split into top-level blocks; finished blocks are memoised, so a streaming answer re-parses
 * and re-lays-out only its last block instead of the whole text on every update.
 */
export function SafeMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const blocks = useMemo(() => splitMarkdownBlocks(normalizeMathDelimiters(text)), [text]);
  if (blocks.length <= 1) return <MarkdownBlock text={text} streaming={streaming} />;
  return (
    <View style={{ gap: 12 }}>
      {blocks.map((block, i) => (
        <MarkdownBlock
          key={`block-${i}`}
          text={block}
          streaming={streaming && i === blocks.length - 1}
        />
      ))}
    </View>
  );
}

const MarkdownBlock = memo(function MarkdownBlock({
  text: raw,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const citations = useContext(CitationContext);
  const cited = useMemo(
    () =>
      citations.source ? extractCitations(raw, streaming) : { text: raw, ids: [] as string[] },
    [raw, streaming, citations.source],
  );
  const text = useMemo(() => entityLinks(cited.text, streaming), [cited.text, streaming]);
  const handleLink = useContext(LinkHandlerContext);
  const views = cited.ids
    .map((id) => citations.source?.resolve(id))
    .filter((v): v is CitationView => !!v);
  const host = useContentHost();
  const { kit, mode } = useUI();
  const { reduced } = useMotion();
  const ty = resolveTypography(kit, Platform.OS === "ios" ? "ios" : "android");
  const colors = kit.tokens[mode];
  const headings = Object.fromEntries(
    ty.heading.sizes.map((size, index) => [
      `h${index + 1}`,
      {
        fontFamily: ty.heading.nativeFamily,
        fontSize: size,
        fontWeight: String(ty.heading.weight),
        lineHeight: ty.heading.lineHeights[index],
        color: colors.foreground,
      },
    ]),
  );
  let parts: ReturnType<typeof prepareMarkdown>;
  try {
    parts = prepareMarkdown(text, 65536, host?.policy.formattingHtml);
  } catch {
    return <Text accessibilityRole="alert">Markdown is too large to display.</Text>;
  }
  const content = (
    <View style={{ gap: 12 }}>
      {parts.map((part, i) =>
        "attachmentId" in part ? (
          <AttachmentMedia key={`image-${i}`} id={part.attachmentId} alt={part.alt} />
        ) : (
          <EnrichedMarkdownText
            key={`text-${i}-${kit.id}-${mode}`}
            markdown={part.markdown}
            flavor="github"
            streamingAnimation={streaming && !reduced}
            enableLinkPreview={false}
            enableTaskListItemToggle={false}
            md4cFlags={{ highlight: true, underline: false, latexMath: true }}
            onLinkPress={({ url }) => {
              if (handleLink?.(url)) return;
              if (url.startsWith("entity:")) return;
              void openContentLink(host, url).catch(() =>
                host?.onDiagnostic?.("LINK_BLOCKED", "external"),
              );
            }}
            onLinkLongPress={() => {}}
            markdownStyle={{
              ...headings,
              paragraph: {
                fontSize: ty.body.size,
                lineHeight: ty.body.lineHeight,
                color: colors.foreground,
                fontFamily: ty.body.nativeFamily,
              },
              link: { color: colors.accent },
              // An entity reads as text with an underline; tapping it opens the host's sheet.
              linkVariants: { "^entity:": { color: colors.foreground, underline: true } },
              highlight: {
                backgroundColor: withAlpha(colors.accent, mode === "dark" ? 0.32 : 0.18),
                color: colors.foreground,
              },
              list: {
                color: colors.foreground,
                bulletColor: colors.foreground,
                markerColor: colors.foreground,
              },
              blockquote: { color: colors.foreground, borderColor: colors.border },
              table: {
                color: colors.foreground,
                headerTextColor: colors.foreground,
                headerBackgroundColor: colors.surface,
                rowEvenBackgroundColor: colors.background,
                rowOddBackgroundColor: colors.surface,
                borderColor: colors.border,
              },
              math: { color: colors.foreground, backgroundColor: colors.surface },
              inlineMath: { color: colors.foreground },
              code: {
                color: colors.foreground,
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
              codeBlock: {
                color: colors.foreground,
                backgroundColor: colors.surface,
                syntaxColors: {
                  keyword: colors.accent,
                  string: colors.success,
                  number: colors.accent,
                  comment: colors.muted,
                  function: colors.foreground,
                  type: colors.accent,
                  variable: colors.foreground,
                  property: colors.foreground,
                  operator: colors.foreground,
                  punctuation: colors.foreground,
                },
              },
            }}
          />
        ),
      )}
    </View>
  );
  if (!views.length) return content;
  const cite = citations.render ? citations.render(views) : <DefaultCitations views={views} />;
  const plain = plainParagraph(text);
  if (plain == null) {
    return (
      <View style={{ gap: 8 }}>
        {content}
        {cite}
      </View>
    );
  }
  return (
    <TrailingCitation
      plain={plain}
      font={{
        fontSize: ty.body.size,
        lineHeight: ty.body.lineHeight,
        fontFamily: ty.body.nativeFamily,
      }}
      cite={cite}
    >
      {content}
    </TrailingCitation>
  );
});

/**
 * The words of a block that is one plain paragraph (no list, heading, table, quote, code or
 * display maths), as they read: inline markers and link targets removed. Null otherwise.
 */
function plainParagraph(text: string): string | null {
  const t = text.trim();
  if (!t || /\n\s*\n/.test(t) || /\$\$|```|^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\|)/m.test(t))
    return null;
  return t
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|==|\*|_|`)(?=\S)([^\n]*?\S)\1/g, "$2")
    .replace(/\$([^$]+)\$/g, "$1")
    .replace(/\s*\n\s*/g, " ");
}

/**
 * A paragraph with its citation right after the last word when there is room on that line,
 * else on the line below. The native markdown text reports no line layout, so an invisible RN
 * twin in the same font is measured. It runs slightly wider than the native text, which keeps
 * the pill clear of the words; when it wraps to a different number of lines than the real
 * paragraph (read from its height), the pill goes below.
 */
function TrailingCitation({
  plain,
  font,
  cite,
  children,
}: {
  plain: string;
  font: { fontSize: number; lineHeight: number; fontFamily?: string };
  cite: ReactNode;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(0);
  const [last, setLast] = useState<{ width: number; lines: number; lineHeight: number } | null>(
    null,
  );
  const [height, setHeight] = useState(0);
  const [citeSize, setCiteSize] = useState<{ width: number; height: number } | null>(null);
  const gap = 6;
  const sameLines = !!last && height > 0 && Math.round(height / last.lineHeight) === last.lines;
  const inline =
    sameLines &&
    !!last &&
    !!citeSize &&
    width > 0 &&
    last.width + gap + citeSize.width <= width - 2;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>{children}</View>
      {width > 0 ? (
        <Text
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          onTextLayout={(e) => {
            const lines = e.nativeEvent.lines;
            const end = lines[lines.length - 1];
            if (end) setLast({ width: end.width, lines: lines.length, lineHeight: end.height });
          }}
          style={{ ...font, position: "absolute", left: 0, top: 0, width, opacity: 0 }}
        >
          {plain}
        </Text>
      ) : null}
      <View
        onLayout={(e) =>
          setCiteSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
        }
        style={
          inline && last && citeSize
            ? {
                position: "absolute",
                left: last.width + gap,
                bottom: Math.max(0, (last.lineHeight - citeSize.height) / 2),
              }
            : { alignSelf: "flex-start", marginTop: 8 }
        }
      >
        {cite}
      </View>
    </View>
  );
}
