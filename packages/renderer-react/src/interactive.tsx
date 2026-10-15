// Web versions of the general-purpose building blocks (see renderer-react-native/interactive.tsx):
// Box, Pager, Flip, Menu, Device, QuizSet and the input variants. Styled with the kit's CSS
// variables (--ui-*), state in the data model when bound, otherwise in the component.
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import type { ComponentViewProps } from "./renderer.js";

export const WEB_LABELS = {
  previous: "Previous",
  next: "Next",
  results: "See results",
  retry: "Try again",
  correct: "Correct",
  incorrect: "Not quite",
  score: "Score",
  flip: "Tap to flip",
  menu: "More",
};

type Props = ComponentViewProps;
const SPACE: Record<string, string> = {
  none: "0",
  xs: "var(--ui-space-xs, 4px)",
  sm: "var(--ui-space-sm, 8px)",
  md: "var(--ui-space-md, 12px)",
  lg: "var(--ui-space-lg, 20px)",
  xl: "var(--ui-space-xl, 32px)",
};
const mix = (color: string, percent: number) =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`;
const TONES: Record<
  string,
  { background?: string; color?: string; border?: string; shadow?: boolean }
> = {
  subtle: { background: "var(--ui-surface)" },
  raised: { background: "var(--ui-background)", border: mix("var(--ui-border)", 60), shadow: true },
  accent: { background: "var(--ui-accent)", color: "var(--ui-onAccent)" },
  accentSoft: { background: mix("var(--ui-accent)", 12) },
  inverse: { background: "var(--ui-foreground)", color: "var(--ui-background)" },
  success: { background: mix("var(--ui-success)", 12) },
  warning: { background: mix("var(--ui-warning, #d97706)", 14) },
  danger: { background: mix("var(--ui-danger)", 12) },
};
const JUSTIFY: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
  around: "space-around",
};
const ALIGN: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
};

function useBound<T>({ node, runtime, surfaceId }: Props, initial: T, key = "value") {
  const path = (node.raw?.[key] as { path?: string } | undefined)?.path;
  const [local, setLocal] = useState<T>(initial);
  const value = (path ? ((node.props[key] as T | undefined) ?? initial) : local) as T;
  const set = (next: T) =>
    path ? runtime.setValue(surfaceId, path, next as unknown, node.scope) : setLocal(next);
  return [value, set] as const;
}

export function WebBox({ node, runtime, surfaceId, children }: Props) {
  const p = node.props as Record<string, any>;
  const row = p.direction === "row" || node.component === "Row";
  const tone = TONES[p.tone as string] ?? {};
  const radius =
    p.radius === "none"
      ? 0
      : p.radius === "sm"
        ? "calc(var(--ui-radius) * 0.5)"
        : p.radius === "lg"
          ? "calc(var(--ui-radius) * 1.6)"
          : p.radius === "full"
            ? 999
            : tone.background || p.border || p.selected
              ? "var(--ui-radius)"
              : 0;
  const style: CSSProperties = {
    display: "flex",
    flexDirection: row ? "row" : "column",
    gap: SPACE[p.gap ?? (row ? "sm" : "md")],
    alignItems: p.align ? ALIGN[p.align] : row ? "center" : "stretch",
    justifyContent: p.justify ? JUSTIFY[p.justify] : "flex-start",
    flexWrap: p.wrap ? "wrap" : "nowrap",
    padding: SPACE[p.padding ?? (tone.background || p.border ? "md" : "none")],
    background: p.selected && !tone.background ? mix("var(--ui-accent)", 10) : tone.background,
    color: tone.color,
    borderRadius: radius,
    border: p.selected
      ? "1.5px solid var(--ui-accent)"
      : p.border || tone.border
        ? `1px solid ${tone.border ?? "var(--ui-border)"}`
        : undefined,
    boxShadow: tone.shadow ? "0 4px 12px rgb(0 0 0 / 0.08)" : undefined,
    overflowX: p.scroll === "horizontal" ? "auto" : undefined,
    width:
      typeof p.width === "number" ? `${p.width * 100}%` : p.width === "fill" ? "100%" : undefined,
    alignSelf: p.width === "hug" ? "flex-start" : undefined,
    flex: typeof p.flex === "number" ? p.flex : undefined,
    height: p.height,
    aspectRatio: p.aspectRatio,
    cursor: p.action ? "pointer" : undefined,
  };
  if (!p.action)
    return (
      <div
        className="ui-box"
        style={style}
        data-node={node.id}
        {...(p.accessibilityLabel
          ? { role: "group", "aria-label": String(p.accessibilityLabel) }
          : {})}
      >
        {children}
      </div>
    );
  return (
    <button
      type="button"
      className="ui-box ui-box-action"
      style={{
        ...style,
        font: "inherit",
        textAlign: "inherit",
        borderStyle: style.border ? undefined : "none",
      }}
      aria-pressed={p.selected === undefined ? undefined : Boolean(p.selected)}
      data-node={node.id}
      onClick={() => void runtime.dispatch(surfaceId, node.id, p.action, node.scope)}
    >
      {children}
    </button>
  );
}

function Round({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: "‹" | "›";
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        border: `1px solid ${mix("var(--ui-border)", 70)}`,
        background: "var(--ui-surface)",
        color: "var(--ui-foreground)",
        fontSize: 22,
        lineHeight: 1,
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {icon}
    </button>
  );
}

function Dots({
  count,
  index,
  colorOf,
}: {
  count: number;
  index: number;
  colorOf?: (i: number) => string | undefined;
}) {
  if (count > 12)
    return (
      <span style={{ color: "var(--ui-muted)" }}>
        {index + 1} / {count}
      </span>
    );
  return (
    <span
      role="img"
      aria-label={`${index + 1} / ${count}`}
      style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
    >
      {Array.from({ length: count }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: dots are positional
          key={i}
          style={{
            width: i === index ? 18 : 6,
            height: 6,
            borderRadius: 3,
            background: colorOf?.(i) ?? (i === index ? "var(--ui-foreground)" : "var(--ui-border)"),
          }}
        />
      ))}
    </span>
  );
}

export function WebPager(props: Props) {
  const p = props.node.props as Record<string, any>;
  const pages = Array.isArray(props.children) ? (props.children as ReactNode[]) : [props.children];
  const count = pages.length;
  const [stored, setStored] = useBound<number>(props, 0);
  const index = Math.min(Math.max(0, Math.round(Number(stored) || 0)), Math.max(0, count - 1));
  const go = (next: number) =>
    setStored(p.loop ? (next + count) % count : Math.min(count - 1, Math.max(0, next)));
  const controls = p.controls ?? "both";
  return (
    <div className="ui-pager" style={{ display: "grid", gap: 12 }} data-node={props.node.id}>
      <div>{pages[index]}</div>
      {controls !== "none" && count > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: controls === "dots" ? "center" : "space-between",
          }}
        >
          {controls !== "dots" && (
            <Round
              label={WEB_LABELS.previous}
              icon="‹"
              onClick={() => go(index - 1)}
              disabled={!p.loop && index === 0}
            />
          )}
          {controls !== "arrows" && <Dots count={count} index={index} />}
          {controls !== "dots" && (
            <Round
              label={WEB_LABELS.next}
              icon="›"
              onClick={() => go(index + 1)}
              disabled={!p.loop && index === count - 1}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function WebFlip(props: Props) {
  const p = props.node.props as Record<string, any>;
  const [flipped, setFlipped] = useBound<boolean>(props, false);
  const face = (back: boolean): CSSProperties => ({
    gridArea: "1 / 1",
    display: "grid",
    placeItems: "center",
    minHeight: p.height ?? 160,
    padding: 20,
    borderRadius: "calc(var(--ui-radius) * 1.6)",
    background: back ? mix("var(--ui-accent)", 10) : "var(--ui-surface)",
    border: `1px solid ${back ? mix("var(--ui-accent)", 30) : mix("var(--ui-border)", 60)}`,
    backfaceVisibility: "hidden",
    transform: back ? "rotateY(180deg)" : undefined,
  });
  return (
    <button
      type="button"
      aria-label={WEB_LABELS.flip}
      aria-pressed={flipped}
      onClick={() => setFlipped(!flipped)}
      style={{ all: "unset", display: "block", perspective: 1000, cursor: "pointer" }}
      data-node={props.node.id}
    >
      <div
        style={{
          display: "grid",
          transformStyle: "preserve-3d",
          transition: "transform 0.4s ease",
          transform: flipped ? "rotateY(180deg)" : undefined,
        }}
      >
        <div style={face(false)} aria-hidden={flipped}>
          {props.renderChild(p.front)}
        </div>
        <div style={face(true)} aria-hidden={!flipped}>
          {props.renderChild(p.back)}
        </div>
      </div>
    </button>
  );
}

export function WebMenu({ node, runtime, surfaceId }: Props) {
  const p = node.props as Record<string, any>;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const raw = (node.raw?.items as { action: unknown }[] | undefined) ?? [];
  return (
    <div ref={root} style={{ position: "relative", display: "inline-block" }} data-node={node.id}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={p.label ? String(p.label) : WEB_LABELS.menu}
        onClick={() => setOpen(!open)}
        className="ui-button quiet"
        style={{ minWidth: 40, borderRadius: 20 }}
      >
        {p.label ? String(p.label) : "⋯"}
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            minWidth: 200,
            padding: 4,
            borderRadius: "calc(var(--ui-radius) * 1.4)",
            background: "var(--ui-background)",
            border: `1px solid ${mix("var(--ui-border)", 60)}`,
            boxShadow: "0 8px 24px rgb(0 0 0 / 0.16)",
            zIndex: 10,
          }}
        >
          {(p.items ?? []).map((item: any, i: number) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: menu rows are positional
              key={i}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void runtime.dispatch(
                  surfaceId,
                  node.id,
                  (raw[i]?.action ?? item.action) as never,
                  node.scope,
                );
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "12px 16px",
                border: 0,
                background: "transparent",
                font: "inherit",
                color: item.tone === "danger" ? "var(--ui-danger)" : "var(--ui-foreground)",
                cursor: "pointer",
              }}
            >
              {String(item.label)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function WebDevice({ node, children }: Props) {
  const p = node.props as Record<string, any>;
  const kind = p.kind ?? "phone";
  if (kind === "browser")
    return (
      <div
        data-node={node.id}
        style={{
          borderRadius: 14,
          border: "1px solid var(--ui-border)",
          overflow: "hidden",
          background: "var(--ui-background)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            height: 40,
            padding: "0 12px",
            background: "var(--ui-surface)",
          }}
        >
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <span key={c} style={{ width: 10, height: 10, borderRadius: 5, background: c }} />
          ))}
          <span
            style={{
              flex: 1,
              height: 26,
              borderRadius: 13,
              background: "var(--ui-background)",
              padding: "0 12px",
              fontSize: 12,
              lineHeight: "26px",
              color: "var(--ui-muted)",
            }}
          >
            {String(p.title ?? "")}
          </span>
        </div>
        <div style={{ padding: 16, display: "grid", gap: 12 }}>{children}</div>
      </div>
    );
  const phone = kind === "phone";
  return (
    <div
      data-node={node.id}
      role="group"
      aria-label={p.title ? String(p.title) : undefined}
      style={{
        margin: "0 auto",
        width: phone ? 300 : 520,
        maxWidth: "100%",
        minHeight: phone ? 570 : 380,
        borderRadius: phone ? 44 : 28,
        border: `${phone ? 9 : 11}px solid ${mix("var(--ui-foreground)", 92)}`,
        background: "var(--ui-background)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          height: 34,
          padding: "0 20px",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        <span>9:41</span>
        {phone && (
          <span
            style={{
              width: 76,
              height: 22,
              borderRadius: 11,
              background: mix("var(--ui-foreground)", 92),
            }}
          />
        )}
        <span>▮▮▮</span>
      </div>
      <div
        style={{ flex: 1, padding: "0 16px 20px", display: "grid", alignContent: "start", gap: 12 }}
      >
        {children}
      </div>
    </div>
  );
}

export function WebQuizSet(props: Props) {
  const p = props.node.props as Record<string, any>;
  const questions = (p.questions ?? []) as {
    prompt: unknown;
    choices: unknown[];
    correctIndex: number;
    explanation?: unknown;
  }[];
  const total = questions.length;
  const [stored, setStored] = useBound<unknown[]>(props, []);
  const answers = Array.from({ length: total }, (_, i) =>
    Array.isArray(stored) && Number.isInteger(stored[i]) ? (stored[i] as number) : null,
  );
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState(false);
  const score = answers.filter((a, i) => a !== null && a === questions[i]?.correctIndex).length;
  const q = questions[index];
  if (results)
    return (
      <div style={{ display: "grid", gap: 16, justifyItems: "center" }} data-node={props.node.id}>
        <strong style={{ fontSize: "2.6em" }} aria-live="polite">
          {score}
          <span style={{ color: "var(--ui-muted)", fontWeight: 500 }}> / {total}</span>
        </strong>
        <Dots
          count={total}
          index={-1}
          colorOf={(i) =>
            answers[i] === questions[i]?.correctIndex ? "var(--ui-success)" : "var(--ui-danger)"
          }
        />
        <button
          type="button"
          className="ui-button secondary"
          onClick={() => {
            setStored([]);
            setIndex(0);
            setResults(false);
          }}
        >
          {WEB_LABELS.retry}
        </button>
      </div>
    );
  if (!q) return null;
  const answer = answers[index];
  const answered = answer !== null;
  return (
    <div style={{ display: "grid", gap: 16 }} data-node={props.node.id}>
      <div style={{ display: "flex", justifyContent: "space-between", color: "var(--ui-muted)" }}>
        <strong style={{ color: "var(--ui-foreground)" }}>{p.title ? String(p.title) : ""}</strong>
        <span>
          {index + 1} / {total}
        </span>
      </div>
      <strong style={{ fontSize: "1.13em" }}>{String(q.prompt)}</strong>
      <div role="radiogroup" style={{ display: "grid", gap: 8 }}>
        {q.choices.map((choice, i) => {
          const right = answered && i === q.correctIndex;
          const wrong = answered && i === answer && !right;
          const tint = right ? "var(--ui-success)" : wrong ? "var(--ui-danger)" : null;
          return (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: choices are positional
              key={i}
              type="button"
              role="radio"
              aria-checked={answer === i}
              disabled={answered}
              onClick={() => {
                const next = [...answers];
                next[index] = i;
                setStored(next);
              }}
              style={{
                textAlign: "left",
                padding: "12px 14px",
                borderRadius: "var(--ui-radius)",
                border: `1.5px solid ${tint ?? "transparent"}`,
                background: tint ? mix(tint, 12) : "var(--ui-surface)",
                color: "var(--ui-foreground)",
                font: "inherit",
                opacity: answered && !tint ? 0.55 : 1,
                cursor: answered ? "default" : "pointer",
              }}
            >
              {String.fromCharCode(65 + i)}. {String(choice)}
            </button>
          );
        })}
      </div>
      {answered && (
        <p aria-live="polite" style={{ margin: 0 }}>
          <strong
            style={{ color: answer === q.correctIndex ? "var(--ui-success)" : "var(--ui-danger)" }}
          >
            {answer === q.correctIndex ? WEB_LABELS.correct : WEB_LABELS.incorrect}
          </strong>{" "}
          {q.explanation ? String(q.explanation) : ""}
        </p>
      )}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Round
          label={WEB_LABELS.previous}
          icon="‹"
          onClick={() => setIndex(index - 1)}
          disabled={index === 0}
        />
        {index === total - 1 && answers.every((a) => a !== null) ? (
          <button type="button" className="ui-button primary" onClick={() => setResults(true)}>
            {WEB_LABELS.results}
          </button>
        ) : (
          <Round
            label={WEB_LABELS.next}
            icon="›"
            onClick={() => setIndex(index + 1)}
            disabled={index === total - 1}
          />
        )}
      </div>
    </div>
  );
}
