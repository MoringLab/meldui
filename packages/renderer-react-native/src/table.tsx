import { resolveTypography } from "@engine/kit-spec";
import { Fragment, memo, type ReactNode, useContext, useState } from "react";
import { Dimensions, Platform, StyleSheet, Text, type TextStyle, View } from "react-native";
import { heavier, withAlpha } from "./interactive.js";
import { LinkHandlerContext } from "./markdown.js";
import { useUI } from "./renderer.js";

// Tables in a reply never scroll sideways. A few narrow columns share the width as a grid
// (cells wrap); a table too wide for that becomes a list of records: each row a small block,
// its first cell as the title and the rest as label · value lines.

export type TableData = { header: string[]; rows: string[][]; align?: ("left" | "right" | "center" | null)[] };

/** A GFM table ("| a | b |" then "|---|---|") inside a block of Markdown: the text before, the table, the text after. */
export function splitTable(block: string): { before: string; table: TableData; after: string } | null {
  const lines = block.split("\n");
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i]!.includes("|") || !DELIM.test(lines[i + 1]!)) continue;
    const header = cells(lines[i]!);
    if (header.length < 2) continue;
    const align = cells(lines[i + 1]!).map((d) =>
      /^:-+:$/.test(d) ? "center" : /-:$/.test(d) ? "right" : /^:-/.test(d) ? "left" : null,
    );
    let j = i + 2;
    const rows: string[][] = [];
    for (; j < lines.length && lines[j]!.includes("|") && lines[j]!.trim(); j++) {
      const row = cells(lines[j]!);
      rows.push(header.map((_, k) => row[k] ?? ""));
    }
    return {
      before: lines.slice(0, i).join("\n").trim(),
      table: { header, rows, align },
      after: lines.slice(j).join("\n").trim(),
    };
  }
  return null;
}

const DELIM = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function cells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const out: string[] = [];
  let cur = "";
  let code = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "`") {
      code = !code;
      cur += ch;
    } else if (ch === "|" && !code) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** About how wide `text` draws at `size` (Hangul and CJK twice a Latin letter). */
function textWidth(text: string, size: number) {
  let w = 0;
  for (const ch of plain(text)) w += ch > "⹿" ? size * 0.98 : ch === " " ? size * 0.28 : size * 0.55;
  return w;
}
const plain = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "");
const longestWord = (s: string, size: number) =>
  Math.max(0, ...plain(s).split(/\s+/).map((w) => textWidth(w, size)));

const GAP = 12;

/** Grid when every column gets room for its longest word and rows stay a few lines tall. */
export function tableLayout(t: TableData, width: number, size: number): { grid: boolean; shares: number[] } {
  const n = t.header.length;
  const all = [t.header, ...t.rows];
  const ideal = t.header.map((_, c) => Math.min(170, Math.max(28, ...all.map((r) => textWidth(r[c] ?? "", size)))));
  const least = t.header.map((_, c) => Math.max(24, ...all.map((r) => longestWord(r[c] ?? "", size))));
  if (!width) return { grid: n <= 3, shares: ideal };
  const room = width - GAP * (n - 1);
  const total = ideal.reduce((a, b) => a + b, 0);
  const shares = ideal.map((w) => (w / total) * room);
  const fitsWords = shares.every((w, c) => w >= Math.min(least[c]!, 120));
  // Rows taller than four lines read better as records.
  const lines = Math.max(
    1,
    ...t.rows.map((r) => Math.max(...r.map((cell, c) => Math.ceil(textWidth(cell, size) / Math.max(shares[c]!, 1))))),
  );
  return { grid: n <= 2 || (fitsWords && lines <= 4 && n <= 5), shares };
}

/** Bold, code, strikethrough, links and line breaks inside one cell. */
function Inline({ text, style, color }: { text: string; style: TextStyle; color: { link: string; code: string } }): ReactNode {
  const onLink = useContext(LinkHandlerContext);
  const parts: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|~~([^~]+)~~|\[([^\]]+)\]\(([^)\s]+)\)|<br\s*\/?>/gi;
  let at = 0;
  let k = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > at) parts.push(text.slice(at, m.index));
    if (m[1] ?? m[2]) parts.push(<Text key={k++} style={{ fontWeight: "600" }}>{m[1] ?? m[2]}</Text>);
    else if (m[3]) parts.push(<Text key={k++} style={{ backgroundColor: color.code, fontSize: (style.fontSize ?? 14) - 1 }}>{m[3]}</Text>);
    else if (m[4]) parts.push(<Text key={k++} style={{ textDecorationLine: "line-through" }}>{m[4]}</Text>);
    else if (m[5])
      parts.push(
        <Text key={k++} style={{ color: color.link }} onPress={() => onLink?.(m[6]!)} suppressHighlighting>
          {m[5]}
        </Text>,
      );
    else parts.push("\n");
    at = m.index! + m[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <Text style={style}>{parts}</Text>;
}

export const FitTable = memo(function FitTable({ data, title }: { data: TableData; title?: string }) {
  const { kit, mode, selectable } = useUI();
  const t = kit.tokens[mode];
  const ty = resolveTypography(kit, Platform.OS === "ios" ? "ios" : "android");
  // A first guess from the screen (a bubble's width), corrected once it is measured: the table
  // draws on its first frame.
  const [width, setWidth] = useState(() => Math.round(Dimensions.get("window").width * 0.68));
  const size = 14;
  const text: TextStyle = {
    color: t.foreground,
    fontSize: size,
    lineHeight: 20,
    ...(ty.body.nativeFamily ? { fontFamily: ty.body.nativeFamily } : {}),
  };
  const muted: TextStyle = { ...text, color: t.muted, fontSize: 12, lineHeight: 16 };
  const colors = { link: t.accent, code: withAlpha(t.foreground, 0.08) };
  const line = { borderColor: withAlpha(t.foreground, 0.1) };
  const numeric = (c: number) =>
    data.rows.length > 0 && data.rows.every((r) => /^[-+₩$€]?\s?[\d.,]+\s?\S{0,3}$/.test(plain(r[c] ?? "").trim()));
  const { grid, shares } = tableLayout(data, width, size);
  const align = (c: number): TextStyle["textAlign"] =>
    data.align?.[c] === "center" ? "center" : data.align?.[c] === "right" || (c > 0 && numeric(c)) ? "right" : "left";

  const body = !width ? null : grid ? (
    <View>
      <View style={{ flexDirection: "row", gap: GAP, paddingBottom: 6 }}>
        {data.header.map((h, c) => (
          <Text key={c} style={{ ...muted, flex: shares[c], textAlign: align(c) }} selectable={selectable}>
            {plain(h)}
          </Text>
        ))}
      </View>
      {data.rows.map((r, i) => (
        <View key={i} style={{ ...line, flexDirection: "row", gap: GAP, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth }}>
          {r.map((cell, c) => (
            <View key={c} style={{ flex: shares[c] }}>
              <Inline
                text={cell}
                color={colors}
                style={{ ...text, textAlign: align(c), ...(c === 0 ? heavier(ty, 500) : { fontVariant: ["tabular-nums"] }) }}
              />
            </View>
          ))}
        </View>
      ))}
    </View>
  ) : (
    // Records: the first cell names the row, the others follow as label · value.
    <View>
      {data.rows.map((r, i) => (
        <View key={i} style={{ ...line, paddingVertical: 10, gap: 4, borderTopWidth: i ? StyleSheet.hairlineWidth : 0 }}>
          <Inline text={r[0] ?? ""} color={colors} style={{ ...text, ...heavier(ty, 600), fontSize: 15, lineHeight: 21 }} />
          {r.slice(1).map((cell, c) =>
            cell.trim() ? (
              <View key={c} style={{ flexDirection: "row", gap: 10 }}>
                <Text style={{ ...muted, width: "34%", lineHeight: 20 }} numberOfLines={2}>
                  {plain(data.header[c + 1] ?? "")}
                </Text>
                <View style={{ flex: 1 }}>
                  <Inline text={cell} color={colors} style={{ ...text, fontVariant: ["tabular-nums"] }} />
                </View>
              </View>
            ) : (
              <Fragment key={c} />
            ),
          )}
        </View>
      ))}
    </View>
  );
  return (
    <View style={{ gap: 8 }} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
      {title ? (
        <Text accessibilityRole="header" style={{ ...muted, ...heavier(ty, 500), fontSize: 13, lineHeight: 18 }}>
          {title}
        </Text>
      ) : null}
      {body ?? <View style={{ height: 20 + 38 * Math.min(data.rows.length, 6) }} />}
    </View>
  );
});
