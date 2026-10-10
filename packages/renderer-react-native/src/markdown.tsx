// biome-ignore-all lint/suspicious/noArrayIndexKey: append-only Markdown segments retain their order during streaming
import { prepareMarkdown } from "@engine/core";
import { resolveTypography } from "@engine/kit-spec";
import React from "react";
import { Platform, Text, View } from "react-native";
import { EnrichedMarkdownText } from "react-native-enriched-markdown";
import { AttachmentMedia, openContentLink, useContentHost } from "./content.js";
import { useMotion, useUI } from "./renderer.js";
/** The mdast boundary removes every image URL and raw HTML before native parsing. */
export function SafeMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
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
    parts = prepareMarkdown(text);
  } catch {
    return <Text accessibilityRole="alert">Markdown is too large to display.</Text>;
  }
  return (
    <View style={{ gap: 12 }}>
      {parts.map((part, i) =>
        "attachmentId" in part ? (
          <AttachmentMedia key={`image-${i}`} id={part.attachmentId} alt={part.alt} />
        ) : (
          <EnrichedMarkdownText
            key={`text-${i}`}
            markdown={part.markdown}
            flavor="github"
            streamingAnimation={streaming && !reduced}
            enableLinkPreview={false}
            enableTaskListItemToggle={false}
            onLinkPress={({ url }) =>
              void openContentLink(host, url).catch(() =>
                host?.onDiagnostic?.("LINK_BLOCKED", "external"),
              )
            }
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
              codeBlock: { color: colors.foreground, backgroundColor: colors.surface },
            }}
          />
        ),
      )}
    </View>
  );
}
