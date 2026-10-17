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
import React, { createContext, memo, type ReactNode, useContext, useMemo } from "react";
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
  return (
    <View style={{ gap: 8 }}>
      {content}
      {citations.render ? citations.render(views) : <DefaultCitations views={views} />}
    </View>
  );
});
