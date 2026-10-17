export type CitationLine = {
  x: number;
  y: number;
  width: number;
  height: number;
  rtl: boolean;
};

/** Position against the rendered line, including list indentation and styled text. */
export function citationPosition(
  line: CitationLine | null,
  size: { width: number; height: number } | null,
  width: number,
): { left: number; top: number } | null {
  if (!line || !size || width <= 0) return null;
  const left = line.rtl ? line.x - 6 - size.width : line.x + line.width + 6;
  if (left < 0 || left + size.width > width) return null;
  return { left, top: line.y + Math.max(0, (line.height - size.height) / 2) };
}
