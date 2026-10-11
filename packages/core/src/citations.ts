/**
 * Inline source citations. A model cites a source the host gave it with a short bracketed id
 * right after the claim ("…39,900원이에요 [w1]."). Renderers remove the markers from the text
 * and show the cited sources next to that block; the host decides what an id resolves to,
 * so an id the host does not know is simply dropped. Ids are short (one to three letters and
 * a number) so they cost few tokens and never collide with ordinary bracketed text.
 */
export type CitationView = {
  id: string;
  title: string;
  /** Short site or source label shown before the title, e.g. "musinsa.com" or "내 보관함". */
  site?: string;
  /** Host-resolved icon URL (already allowed by the host); renderers may show a letter instead. */
  iconUrl?: string;
  kind?: string;
};
export type CitationSource = { resolve(id: string): CitationView | undefined };

const MARKER = /[ \t]?\[([A-Za-z]{1,3}\d{1,3})\](?![(:])/g;
const PARTIAL = /[ \t]?\[[A-Za-z]{0,3}\d{0,3}$/;
const FENCE = /^\s{0,3}(```|~~~)/;

/**
 * Removes citation markers outside code and returns the cited ids in first-use order. While
 * streaming, a half-received marker at the very end is held back instead of flashing as text.
 */
export function extractCitations(text: string, streaming = false): { text: string; ids: string[] } {
  const ids: string[] = [];
  let fence = false;
  const lines = text.split("\n").map((line) => {
    if (FENCE.test(line)) {
      fence = !fence;
      return line;
    }
    if (fence) return line;
    // Keep inline code spans literal.
    return line
      .split(/(`[^`]*`)/)
      .map((part) =>
        part.startsWith("`")
          ? part
          : part.replace(MARKER, (_, id: string) => {
              if (!ids.includes(id)) ids.push(id);
              return "";
            }),
      )
      .join("");
  });
  let out = lines.join("\n");
  if (streaming && !fence) out = out.replace(PARTIAL, "");
  return { text: out, ids };
}
