/**
 * Entity links: a proper noun the reader can open, written wiki-style
 *   [[Google]]  ·  [[구글|Google · 기업 · 1998 · 검색]]  ·  [[소나기|소설 · 황순원 · 1953]]
 * The part after "|" names and describes the entity (name · kind · facts) so a host can find
 * it among entities it already knows, and tell same-name ones apart. In Markdown they become
 * links with the `entity:` scheme (underlined by the renderer, opened by the host).
 */
export type EntityRef = { text: string; name: string; hints: string[] };

// A "·" only separates hints when spaced ("3·1 운동 · 독립운동" keeps "3·1 운동" whole).
const HINT_SEPARATOR = /\s+[·•]\s+|\s*[;|]\s*/;

const LINK = /\[\[([^[\]|\n]{1,80})(?:\|([^[\]\n]{1,240}))?\]\]/g;

export function entityUrl(ref: EntityRef): string {
  return `entity:${encodeURIComponent(JSON.stringify([ref.name, ...ref.hints]))}`;
}

export function parseEntityUrl(url: string, text = ""): EntityRef | null {
  if (!url.startsWith("entity:")) return null;
  try {
    const parts = JSON.parse(decodeURIComponent(url.slice(7))) as unknown;
    if (!Array.isArray(parts) || typeof parts[0] !== "string") return null;
    return {
      text: text || parts[0],
      name: parts[0],
      hints: parts.slice(1).filter((p): p is string => typeof p === "string"),
    };
  } catch {
    return null;
  }
}

/** [[…]] → Markdown entity links. While streaming, a half-written "[[…" shows as its words. */
export function entityLinks(markdown: string, streaming = false): string {
  if (!markdown.includes("[[")) return markdown;
  let out = markdown.replace(LINK, (_, text: string, about?: string) => {
    const parts = (about ?? "")
      .split(HINT_SEPARATOR)
      .map((p) => p.trim())
      .filter(Boolean);
    const name = parts[0] ?? text.trim();
    const label = text.trim().replace(/[\]\\]/g, "");
    return `[${label}](${entityUrl({ text: label, name, hints: parts.slice(1) })})`;
  });
  if (streaming) out = out.replace(/\[\[([^[\]|\n]*)(\|[^[\]\n]*)?\]?$/, "$1");
  return out;
}

/** Every entity in a text, in order (for prefetching and context). */
export function entitiesIn(markdown: string): EntityRef[] {
  const out: EntityRef[] = [];
  for (const m of markdown.matchAll(LINK)) {
    const parts = (m[2] ?? "")
      .split(HINT_SEPARATOR)
      .map((p) => p.trim())
      .filter(Boolean);
    out.push({
      text: (m[1] as string).trim(),
      name: parts[0] ?? (m[1] as string).trim(),
      hints: parts.slice(1),
    });
  }
  return out;
}
