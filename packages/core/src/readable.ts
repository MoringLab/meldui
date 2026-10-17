/**
 * Readable plain text for compiled UI: what a person would write down when copying or sharing
 * it, one element after another (a table as rows, a collection as a list, a diagram as its boxes
 * and arrows, a chart as its values). Interactive controls give their label and current value;
 * buttons, icons and spacing give nothing. Bound values are read from the compiled data.
 */
type Component = { id: string; component: string; [prop: string]: unknown };

const str = (v: unknown) =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export function readableText(compiled: {
  components: readonly Component[];
  data?: Record<string, unknown>;
}): string {
  const byId = new Map(compiled.components.map((c) => [c.id, c]));
  const data = compiled.data ?? {};
  const seen = new Set<string>();

  /** A value as shown: bindings resolved ("/name/0/title"), computed values skipped. */
  const read = (v: unknown): unknown => {
    if (!isRecord(v)) return v;
    if (typeof v.path === "string") {
      const [head, ...rest] = v.path.split("/").filter(Boolean);
      let at: unknown = head === undefined ? undefined : data[`/${head}`];
      for (const key of rest)
        at = Array.isArray(at) ? at[Number(key)] : isRecord(at) ? at[key] : undefined;
      return at;
    }
    return "call" in v ? undefined : v;
  };
  const s = (v: unknown) => str(read(v));
  const list = (v: unknown): unknown[] => {
    const value = read(v);
    return Array.isArray(value) ? value : [];
  };
  const joined = (...parts: string[]) => parts.filter(Boolean).join(" — ");

  const children = (c: Component): string[] => {
    const value = c.children;
    if (Array.isArray(value)) return value.map((id) => visit(String(id))).filter(Boolean);
    if (isRecord(value) && typeof value.path === "string") {
      // A template repeated over a list: each entry's own words.
      return list({ path: value.path }).map((entry) =>
        isRecord(entry) ? Object.values(entry).map(str).filter(Boolean).join(" · ") : str(entry),
      );
    }
    const extra: string[] = [];
    for (const key of ["child", "front", "back"])
      if (typeof c[key] === "string") extra.push(visit(c[key] as string));
    for (const entry of [...list(c.tabs), ...list(c.items), ...list(c.pages)])
      if (isRecord(entry) && typeof entry.child === "string")
        extra.push(
          [str(entry.label) || str(entry.title), visit(entry.child)].filter(Boolean).join("\n"),
        );
    return extra.filter(Boolean);
  };

  const own = (c: Component): string => {
    switch (c.component) {
      case "Text":
      case "Heading":
      case "Markdown":
      case "Badge":
      case "Annotation":
        return s(c.text);
      case "Callout":
        return [s(c.title), s(c.text)].filter(Boolean).join(": ");
      case "Formula":
        return joined(s(c.latex), s(c.meaning));
      case "CodeBlock":
        return s(c.code);
      case "Image":
        return s(c.alt) || s(c.caption);
      case "Stat":
        return `${s(c.label)}: ${[s(c.value), s(c.unit)].filter(Boolean).join(" ")}`;
      case "Progress":
      case "Slider":
      case "TextField":
      case "Select":
      case "Checkbox":
      case "DatePicker":
        return [s(c.label), s(c.value)].filter(Boolean).join(": ");
      case "Quote":
        return s(c.name) ? `${s(c.name)} (${s(c.symbol)})` : s(c.symbol);
      case "Converter": {
        const rate = s(c.rate);
        return `${s(c.from).toUpperCase()} → ${s(c.to).toUpperCase()}${rate ? ` (1 : ${rate})` : ""}`;
      }
      case "Table": {
        const columns = list(c.columns).filter(isRecord);
        const rows = list(c.rows).map((row) =>
          columns.map((col) => (isRecord(row) ? str(row[str(col.key)]) : "")).join(" | "),
        );
        return [s(c.caption), columns.map((col) => str(col.label)).join(" | "), ...rows]
          .filter(Boolean)
          .join("\n");
      }
      case "Collection":
        return [
          s(c.title),
          ...list(c.items)
            .filter(isRecord)
            .map(
              (item) =>
                `- ${joined(str(item.title) || str(item.alt), str(item.subtitle), str(item.caption))}`,
            ),
        ]
          .filter((line) => line && line !== "- ")
          .join("\n");
      case "Diagram": {
        const nodes = list(c.nodes).filter(isRecord);
        const label = new Map(nodes.map((n) => [str(n.id), str(n.label)]));
        return [
          s(c.title),
          ...nodes.map((n) => `- ${joined(str(n.label), str(n.sub), str(n.detail))}`),
          ...list(c.edges)
            .filter(isRecord)
            .map((e) => {
              const line = `${label.get(str(e.from)) ?? str(e.from)} → ${label.get(str(e.to)) ?? str(e.to)}`;
              return str(e.label) ? `${line}: ${str(e.label)}` : line;
            }),
        ]
          .filter(Boolean)
          .join("\n");
      }
      case "Chart": {
        const xKey = str(c.xKey) || "x";
        const series = list(c.series).filter(isRecord);
        const values = list(c.values).filter(isRecord);
        const keys = series.length
          ? series.map((one) => [str(one.key), str(one.label)] as const)
          : [...new Set(values.flatMap((v) => Object.keys(v)))]
              .filter((k) => k !== xKey)
              .map((k) => [k, k] as const);
        const unit = s(c.yUnit);
        return [
          s(c.title),
          ...values.map((v) => {
            const parts = keys
              .filter(([key]) => str(v[key]))
              .map(
                ([key, name]) =>
                  `${keys.length > 1 ? `${name} ` : ""}${str(v[key])}${unit ? ` ${unit}` : ""}`,
              );
            return `${str(v[xKey])}: ${parts.join(", ")}`;
          }),
        ]
          .filter(Boolean)
          .join("\n");
      }
      case "Walkthrough":
        return list(c.steps)
          .filter(isRecord)
          .map((step, i) => `${i + 1}. ${joined(str(step.title), str(step.text))}`)
          .join("\n");
      case "Quiz":
        return [s(c.prompt), ...list(c.choices).map((choice) => `- ${str(read(choice))}`)].join(
          "\n",
        );
      case "Button":
      case "Icon":
      case "Divider":
      case "Spacer":
        return "";
      default:
        return s(c.title) || s(c.label) || s(c.text);
    }
  };

  function visit(id: string): string {
    if (seen.has(id)) return "";
    seen.add(id);
    const c = byId.get(id);
    if (!c) return "";
    return [own(c), ...children(c)].filter(Boolean).join("\n");
  }
  return visit("root")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
