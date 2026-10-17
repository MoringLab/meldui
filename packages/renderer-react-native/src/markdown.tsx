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
import {
  type ComponentProps,
  type ComponentType,
  createContext,
  memo,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";
import { type NativeSyntheticEvent, Platform, Text, View } from "react-native";
import { EnrichedMarkdownText } from "react-native-enriched-markdown";
import { type CitationLine, citationPosition } from "./citation-layout.js";
import { AttachmentMedia, openContentLink, useContentHost } from "./content.js";
import { withAlpha } from "./interactive.js";
import { useMotion, useUI } from "./renderer.js";

type LastLineLayout = CitationLine & { markdown: string };
// Optional native extension; without it citations stay compact on the following line.
const MeasuredMarkdownText = EnrichedMarkdownText as ComponentType<
  ComponentProps<typeof EnrichedMarkdownText> & {
    onLastLineLayout?: (event: NativeSyntheticEvent<LastLineLayout>) => void;
  }
>;

/**
 * Links a host handles itself (an entity's [[name]], app routes): return true when handled,
 * so the link is not opened as a web page.
 */
export const LinkHandlerContext = createContext<((url: string) => boolean) | null>(null);
/**
 * Extra entries for the selection menu of answer text (e.g. "select the whole answer"); the host
 * gets the selected words. Copy and select-all stay the system's.
 */
export type TextMenuItem = {
  text: string;
  onPress: (event: { text: string; selection: { start: number; end: number } }) => void;
};
export const TextMenuContext = createContext<TextMenuItem[] | undefined>(undefined);
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
  const [lastLine, setLastLine] = useState<LastLineLayout | null>(null);
  const cited = useMemo(
    () =>
      citations.source ? extractCitations(raw, streaming) : { text: raw, ids: [] as string[] },
    [raw, streaming, citations.source],
  );
  const text = useMemo(() => entityLinks(cited.text, streaming), [cited.text, streaming]);
  const handleLink = useContext(LinkHandlerContext);
  const textMenu = useContext(TextMenuContext);
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
          <MeasuredMarkdownText
            key={`text-${i}-${kit.id}-${mode}`}
            markdown={part.markdown}
            onLastLineLayout={
              parts.length === 1 ? (event) => setLastLine(event.nativeEvent) : undefined
            }
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
            contextMenuItems={textMenu}
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
  const part = parts.length === 1 ? parts[0] : null;
  const line =
    part &&
    "markdown" in part &&
    lastLine?.markdown === part.markdown &&
    !/^\s*(```|~~~|\||>|#{1,6}\s)|\$\$/m.test(text)
      ? lastLine
      : null;
  return (
    <TrailingCitation line={line} cite={cite}>
      {content}
    </TrailingCitation>
  );
});

/** The native text view supplies the actual last line; no second text or font estimate. */
function TrailingCitation({
  line,
  cite,
  children,
}: {
  line: CitationLine | null;
  cite: ReactNode;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(0);
  const [citeSize, setCiteSize] = useState<{ width: number; height: number } | null>(null);
  const position = citationPosition(line, citeSize, width);
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {children}
      <View
        onLayout={(e) => setCiteSize(e.nativeEvent.layout)}
        style={[
          { alignSelf: "flex-start", alignItems: "flex-start" },
          position ? { position: "absolute", ...position } : { marginTop: 8 },
        ]}
      >
        {cite}
      </View>
    </View>
  );
}
