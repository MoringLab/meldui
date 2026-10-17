/**
 * Inline marks inside a plain Text component: **bold** and ==highlight== (models write them
 * there as they would in Markdown). Anything else stays literal; an unclosed marker is text.
 */
export type InlineRun = { text: string; bold?: boolean; mark?: boolean };

const MARK = /(\*\*|==)(?=\S)([\s\S]*?\S)\1/g;

export function inlineRuns(text: string): InlineRun[] {
  if (!text.includes("**") && !text.includes("==")) return [{ text }];
  const out: InlineRun[] = [];
  let at = 0;
  for (const match of text.matchAll(MARK)) {
    const start = match.index ?? 0;
    if (start > at) out.push({ text: text.slice(at, start) });
    const inner = match[2] as string;
    const outer = match[1] === "**" ? { bold: true } : { mark: true };
    // One level of nesting: **굵게 ==강조==** or ==강조 **굵게**==.
    for (const run of inlineRuns(inner))
      out.push({
        ...run,
        ...outer,
        ...(run.bold ? { bold: true } : {}),
        ...(run.mark ? { mark: true } : {}),
      });
    at = start + match[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** The runs with their offset in the source text (a stable render key). */
export function keyedRuns(text: string): (InlineRun & { at: number })[] {
  let at = 0;
  return inlineRuns(text).map((run) => {
    const keyed = { ...run, at };
    at += run.text.length;
    return keyed;
  });
}
