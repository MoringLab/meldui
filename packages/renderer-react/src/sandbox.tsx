import type { AnswerBlock } from "@engine/protocol";
import React, { useEffect, useRef, useState } from "react";
import { useUI } from "./renderer.js";
export type SandboxViewerRuntime = {
  verified: true;
  render: (
    request: {
      source: string;
      mode: "html" | "app";
      namespace?: string;
      theme?: Record<string, string>;
      events: ({ type: "click"; x: number; y: number } | { type: "key"; key: string })[];
    },
    signal: AbortSignal,
  ) => Promise<{ screenshot: string; text: string; actions: { name: string }[] }>;
  onAction?: (name: string) => void;
};
export function SandboxView({
  block,
  provider,
}: {
  block: Extract<AnswerBlock, { kind: "sandbox" }>;
  provider?: SandboxViewerRuntime;
}) {
  const { kit, mode } = useUI();
  const theme = Object.fromEntries(
    Object.entries(kit.tokens[mode]).filter(([, value]) => /^#[0-9a-fA-F]{3,8}$/.test(value)),
  );
  const themeKey = JSON.stringify(theme);
  const [result, setResult] = useState<{ screenshot: string; text: string } | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [events, setEvents] = useState<
    ({ type: "click"; x: number; y: number } | { type: "key"; key: string })[]
  >([]);
  const delivered = useRef(0);
  const [stopped, setStopped] = useState(false);
  const active = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    if (!provider?.verified || !block.source || stopped) return;
    const c = new AbortController();
    active.current = c;
    setError(undefined);
    void provider
      .render(
        {
          source: block.source,
          mode: block.mode,
          events,
          namespace: block.id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64),
          theme: JSON.parse(themeKey),
        },
        c.signal,
      )
      .then((value) => {
        if (!c.signal.aborted) {
          setResult(value);
          if (events.length)
            for (const a of value.actions.slice(delivered.current)) provider.onAction?.(a.name);
          delivered.current = value.actions.length;
        }
      })
      .catch(() => {
        if (!c.signal.aborted) setError("Isolated content stopped.");
      });
    return () => c.abort();
  }, [provider, block.source, block.mode, events, stopped, themeKey, block.id]);
  if (block.status === "building")
    return (
      <p role="status" aria-live="polite" className="ui-muted">
        Building interactive content…
      </p>
    );
  if (!provider?.verified || !block.source || block.status === "blocked")
    return <p role="note">{block.fallbackText} (isolated runtime unavailable)</p>;
  return (
    <figure>
      <figcaption>AI-generated interactive content</figcaption>
      {result ? (
        <>
          <button
            type="button"
            aria-label="Interact with isolated content"
            style={{ border: 0, padding: 0, width: "100%", background: "transparent" }}
            onKeyDown={(e) => {
              if (
                ["Enter", " ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) &&
                events.length < 20
              ) {
                e.preventDefault();
                setEvents([...events, { type: "key", key: e.key === " " ? "Space" : e.key }]);
              }
            }}
            onClick={(e) => {
              if (e.detail === 0) return;
              if (events.length >= 20) return;
              const r = e.currentTarget.getBoundingClientRect();
              setEvents([
                ...events,
                {
                  type: "click",
                  x: ((e.clientX - r.left) / r.width) * 640,
                  y: ((e.clientY - r.top) / r.height) * 480,
                },
              ]);
            }}
          >
            <img
              alt={block.fallbackText}
              src={`data:image/png;base64,${result.screenshot}`}
              style={{ width: "100%" }}
            />
          </button>
          <p>{result.text}</p>
        </>
      ) : (
        <p role="status">{stopped ? "Stopped." : "Loading isolated content…"}</p>
      )}
      {error && (
        <p role="alert">
          {error} {block.fallbackText}
        </p>
      )}
      {result && (
        <div className="ui-inline">
          <button
            type="button"
            disabled={events.length >= 20 || stopped}
            onClick={() => setEvents([...events, { type: "key", key: "Tab" }])}
          >
            Focus next sandbox control
          </button>
          <button
            type="button"
            disabled={events.length >= 20 || stopped}
            onClick={() => setEvents([...events, { type: "key", key: "Enter" }])}
          >
            Activate sandbox control
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          active.current?.abort();
          setStopped(true);
          setError("Stopped by host.");
          setResult(undefined);
        }}
      >
        Stop
      </button>
    </figure>
  );
}
