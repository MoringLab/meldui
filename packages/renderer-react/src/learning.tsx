// biome-ignore-all lint/suspicious/noArrayIndexKey: bounded stateless SVG vertices and fixed semantic entries use ordinal positions
import { createSimulation, formatStat, routePoints, sceneShapes, Ticker } from "@engine/core";
import React, { useEffect, useRef, useState } from "react";
import { SafeMarkdown } from "./markdown.js";
import type { ComponentViewProps } from "./renderer.js";
export const learningNames = [
  "Confirmation",
  "ControlPanel",
  "Stat",
  "StatGroup",
  "Legend",
  "Formula",
  "Annotation",
  "Walkthrough",
  "Quiz",
  "Timeline",
  "Playback",
  "SvgScene",
  "Plot",
  "Chart",
  "RouteMap",
  "Simulation",
];
export function LearningView({ node, children, runtime, surfaceId }: ComponentViewProps) {
  const p = node.props;
  const [selection, setSelection] = useState(Number(p.value ?? 0));
  useEffect(() => setSelection(Number(p.value ?? 0)), [p.value]);
  const choose = (value: number) => {
    setSelection(value);
    const path = (node.raw?.value as any)?.path;
    if (path) runtime.setValue(surfaceId, path, value, node.scope);
  };
  switch (node.component) {
    case "Confirmation":
      return (
        <section>
          <h3>{p.title}</h3>
          <p>{p.detail}</p>
          <button
            type="button"
            onClick={() => void runtime.dispatch(surfaceId, node.id, p.action, node.scope)}
          >
            {p.label}
          </button>
        </section>
      );
    case "ControlPanel":
      return (
        <section className="ui-control-panel">
          <h3>{p.title}</h3>
          {children}
        </section>
      );
    case "StatGroup":
      return <div className="ui-stat-group">{children}</div>;
    case "Stat":
      return (
        <p className="ui-stat" role="status" aria-live="polite">
          <span>{p.label}</span>
          <strong>
            {formatStat(p.value, p.precision)} {p.unit}
          </strong>
        </p>
      );
    case "Legend":
      return (
        <ul className="ui-legend">
          {p.items.map((item: any, i: number) => (
            <li key={item.label ?? i}>
              <span style={{ background: color(item.color) }} />
              {item.label}
            </li>
          ))}
        </ul>
      );
    case "Formula":
      return (
        <div>
          <SafeMarkdown text={`$$\n${p.latex}\n$$`} />
          {p.meaning && <p>{p.meaning}</p>}
        </div>
      );
    case "Annotation":
      return <p role="note">{p.text}</p>;
    case "Walkthrough":
      return (
        <section>
          <h3>{p.steps[selection]?.title}</h3>
          <p>{p.steps[selection]?.text}</p>
          <div className="ui-gallery-controls">
            <button type="button" disabled={selection === 0} onClick={() => choose(selection - 1)}>
              Previous step
            </button>
            <span>
              {selection + 1}/{p.steps.length}
            </span>
            <button
              type="button"
              disabled={selection >= p.steps.length - 1}
              onClick={() => choose(selection + 1)}
            >
              Next step
            </button>
          </div>
        </section>
      );
    case "Quiz":
      return (
        <fieldset>
          <legend>{p.prompt}</legend>
          {p.choices.map((choice: string, i: number) => (
            <button
              type="button"
              key={choice}
              aria-pressed={selection === i}
              onClick={() => choose(i)}
            >
              {choice}
            </button>
          ))}
          {selection >= 0 && (
            <p role="status">
              {selection === p.correctIndex ? "Correct." : "Try again."} {p.explanation}
            </p>
          )}
        </fieldset>
      );
    case "Timeline":
      return (
        <ol className="ui-timeline">
          {p.items.map((item: any, i: number) => (
            <li key={i}>
              <strong>{item.label}</strong>
              <p>{item.detail}</p>
              {item.action && (
                <button
                  type="button"
                  onClick={() => void runtime.dispatch(surfaceId, node.id, item.action, node.scope)}
                >
                  Open {item.label}
                </button>
              )}
            </li>
          ))}
        </ol>
      );
    case "Playback":
      return <Clock {...{ node, runtime, surfaceId }} />;
    case "SvgScene":
      return <Scene {...{ node, runtime, surfaceId }} />;
    case "RouteMap": {
      const points = routePoints(p.points);
      return (
        <figure>
          <figcaption>{p.title} — approximate schematic</figcaption>
          <svg viewBox="0 0 500 300" role="img" aria-label={p.title}>
            <polyline
              points={points.map((x) => `${x.x},${x.y}`).join(" ")}
              fill="none"
              stroke="var(--ui-accent)"
            />
            {points.map((x) => (
              <g key={x.label}>
                <circle cx={x.x} cy={x.y} r="5" fill="var(--ui-accent)" />
                <text x={x.x + 8} y={x.y} fill="var(--ui-foreground)">
                  {x.label}
                </text>
              </g>
            ))}
          </svg>
          {p.verifyAction && (
            <button
              type="button"
              onClick={() => void runtime.dispatch(surfaceId, node.id, p.verifyAction, node.scope)}
            >
              Verify locations
            </button>
          )}
          <p>Coordinates supplied by the model need host verification.</p>
        </figure>
      );
    }
    case "Chart":
      return <AdvancedChart p={p} />;
    case "Plot":
      return <Plot p={p} />;
    case "Simulation":
      return <Simulation {...{ node, runtime, surfaceId }} />;
    default:
      return null;
  }
}
function color(value?: string) {
  return value &&
    /^(#|none$|currentColor$|black$|white$|transparent$|red$|blue$|green$|gray$|orange$|purple$|yellow$|pink$|cyan$|magenta$|teal$|navy$)/.test(
      value,
    )
    ? value
    : `var(--ui-${value ?? "accent"})`;
}
function Scene({
  node,
  runtime,
  surfaceId,
}: Pick<ComponentViewProps, "node" | "runtime" | "surfaceId">) {
  const p = node.props;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef<{ x: number; y: number; origin: { x: number; y: number } } | null>(null);
  const prefix = `scene-${surfaceId.replace(/[^A-Za-z0-9_-]/g, "_")}-${node.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const shapes = sceneShapes(p.nodes, runtime, surfaceId, node.scope);
  const elements: React.ReactNode[] = [];
  const stack: { attrs: any; action?: any; label?: string; children: React.ReactNode[] }[] = [
    { attrs: {}, children: elements },
  ];
  shapes.forEach((shape, i) => {
    if (shape.type === "group") {
      stack.push({ attrs: shape.attrs, action: shape.action, label: shape.label, children: [] });
      return;
    }
    if (shape.type === "group-end") {
      const g = stack.pop()!;
      stack.at(-1)!.children.push(
        // biome-ignore lint/a11y/noStaticElementInteractions: SVG parts are focusable keyboard buttons when an action exists.
        // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-pressed is emitted only for the dynamic button role.
        <g
          key={i}
          {...g.attrs}
          data-part={shape.id}
          aria-label={shape.label}
          role={g.action ? "button" : undefined}
          tabIndex={g.action ? 0 : undefined}
          aria-pressed={
            g.action?.functionCall?.call === "setValue"
              ? runtime.read(surfaceId, g.action.functionCall.args.path, node.scope) ===
                g.action.functionCall.args.value
              : undefined
          }
          onClick={() => g.action && runtime.dispatch(surfaceId, node.id, g.action, node.scope)}
          onKeyDown={(event) => {
            if (g.action && ["Enter", " "].includes(event.key)) {
              event.preventDefault();
              void runtime.dispatch(surfaceId, node.id, g.action, node.scope);
            }
          }}
        >
          {g.children}
        </g>,
      );
      return;
    }
    const attrs = { ...shape.attrs };
    if (attrs.clipId) {
      attrs.clipPath = `url(#${prefix}-clip-${attrs.clipId})`;
      delete attrs.clipId;
    }
    if (String(attrs.fill).startsWith("gradient:")) {
      attrs.fill = `url(#${prefix}-${String(attrs.fill).slice(9)})`;
    }
    for (const key of ["fill", "stroke"])
      if (attrs[key] && !String(attrs[key]).startsWith("url(#"))
        attrs[key] = color(String(attrs[key]));
    const click = () =>
      (shape.action || shape.onHover) &&
      runtime.dispatch(surfaceId, node.id, (shape.action ?? shape.onHover) as any, node.scope);
    stack.at(-1)!.children.push(
      React.createElement(
        shape.type,
        {
          ...attrs,
          key: i,
          pointerEvents: shape.dragPath ? "all" : undefined,
          role: shape.dragPath ? "slider" : shape.action || shape.onHover ? "button" : undefined,
          tabIndex: shape.action || shape.onHover || shape.dragPath ? 0 : undefined,
          "aria-valuemin": shape.dragPath ? 0 : undefined,
          "aria-valuemax": shape.dragPath ? 1 : undefined,
          "aria-valuenow": shape.dragPath
            ? Number(runtime.read(surfaceId, shape.dragPath, node.scope) ?? 0)
            : undefined,
          "aria-label": shape.label ?? shape.text ?? p.description,
          onClick: click,
          onPointerEnter: () => {
            if (shape.onHover)
              void runtime.dispatch(surfaceId, node.id, shape.onHover as any, node.scope);
          },
          onFocus: () => {
            if (shape.onHover)
              void runtime.dispatch(surfaceId, node.id, shape.onHover as any, node.scope);
          },
          onKeyDown: (e: React.KeyboardEvent) => {
            if (shape.dragPath && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
              e.preventDefault();
              runtime.setValue(
                surfaceId,
                shape.dragPath,
                Math.max(
                  0,
                  Math.min(
                    1,
                    Number(runtime.read(surfaceId, shape.dragPath, node.scope) ?? 0) +
                      (e.key === "ArrowRight" ? 0.05 : -0.05),
                  ),
                ),
                node.scope,
              );
            }
            if ((shape.action || shape.onHover) && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              void click();
            }
          },
          onPointerDown: shape.dragPath
            ? (e: React.PointerEvent<SVGElement>) => {
                e.currentTarget.setPointerCapture(e.pointerId);
              }
            : undefined,
          onPointerMove: shape.dragPath
            ? (e: React.PointerEvent<SVGElement>) => {
                if (e.buttons) {
                  const svg = e.currentTarget.ownerSVGElement!;
                  const rect = svg.getBoundingClientRect();
                  runtime.setValue(
                    surfaceId,
                    shape.dragPath!,
                    Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
                    node.scope,
                  );
                }
              }
            : undefined,
          style: { touchAction: shape.dragPath ? "none" : undefined },
        },
        shape.type === "text" ? shape.text : undefined,
      ),
    );
  });
  return (
    <figure className="ui-scene">
      <figcaption>{p.title}</figcaption>
      <div className="ui-scene-tools">
        <button
          type="button"
          aria-label="Zoom out"
          disabled={zoom <= 1}
          onClick={() => setZoom(Math.max(1, zoom - 0.25))}
        >
          −
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={zoom >= 2}
          onClick={() => setZoom(Math.min(2, zoom + 0.25))}
        >
          +
        </button>
        <button
          type="button"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          Fit
        </button>
      </div>
      <svg
        onPointerDown={(event) => {
          if (zoom <= 1 || (event.target !== event.currentTarget && !event.shiftKey)) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragging.current = { x: event.clientX, y: event.clientY, origin: pan };
        }}
        onPointerMove={(event) => {
          const d = dragging.current;
          if (!d) return;
          const rect = event.currentTarget.getBoundingClientRect();
          setPan({
            x: d.origin.x - ((event.clientX - d.x) * p.viewBox[2]) / rect.width / zoom,
            y: d.origin.y - ((event.clientY - d.y) * p.viewBox[3]) / rect.height / zoom,
          });
        }}
        onPointerUp={() => {
          dragging.current = null;
        }}
        onPointerCancel={() => {
          dragging.current = null;
        }}
        viewBox={p.viewBox
          .map((v: number, i: number) =>
            i < 2
              ? v + (p.viewBox[i + 2] * (1 - 1 / zoom)) / 2 + (i === 0 ? pan.x : pan.y)
              : v / zoom,
          )
          .join(" ")}
        role={shapes.some((s) => s.action || s.dragPath) ? "group" : "img"}
        aria-label={p.title}
      >
        <title>{p.title}</title>
        <desc>{p.description}</desc>
        <defs>
          {p.gradients?.map((g: any) => (
            <linearGradient id={`${prefix}-${g.id}`} key={g.id}>
              {g.stops.map((stop: any) => (
                <stop key={stop.offset} offset={stop.offset} stopColor={color(stop.color)} />
              ))}
            </linearGradient>
          ))}
          {p.clips?.map((clip: any) => (
            <clipPath id={`${prefix}-clip-${clip.id}`} key={clip.id}>
              <rect x={clip.x} y={clip.y} width={clip.width} height={clip.height} />
            </clipPath>
          ))}
        </defs>
        {elements}
      </svg>
      <p className="ui-muted">{p.description}</p>
    </figure>
  );
}
function Plot({ p }: { p: any }) {
  const points = (p.values ?? [])
    .slice(0, 1000)
    .map((v: any, i: number) => ({
      x:
        typeof v === "number"
          ? p.domain
            ? p.domain[0] + (i * (p.domain[1] - p.domain[0])) / Math.max(1, p.values.length - 1)
            : i
          : v[p.xKey],
      y: typeof v === "number" ? v : v[p.yKey],
    }))
    .filter((v: any) => Number.isFinite(v.x) && Number.isFinite(v.y));
  const ys = points.map((v: any) => v.y),
    xs = points.map((v: any) => v.x);
  const min = Math.min(0, ...ys),
    max = Math.max(1e-9, ...ys) * 1.08,
    xmin = Math.min(0, ...xs),
    xmax = Math.max(1, ...xs);
  const x = (v: number) => 40 + ((v - xmin) / (xmax - xmin)) * 460,
    y = (v: number) => 200 - ((v - min) / (max - min)) * 170;
  return (
    <figure className="ui-chart">
      <figcaption>{p.title}</figcaption>
      <svg viewBox="0 0 540 240" role="img" aria-label={p.title}>
        <line x1="40" x2="500" y1="200" y2="200" stroke="var(--ui-border)" />
        {Array.from({ length: 5 }, (_, i) => xmin + ((xmax - xmin) * i) / 4).map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1="200" y2="205" stroke="var(--ui-border)" />
            <text x={x(v)} y="221" textAnchor="middle" fill="var(--ui-muted)" fontSize="11">
              {Number(v.toPrecision(3))}
            </text>
          </g>
        ))}
        {Array.from({ length: 4 }, (_, i) => min + ((max - min) * i) / 3).map((v) => (
          <g key={v}>
            <line
              x1="40"
              x2="500"
              y1={y(v)}
              y2={y(v)}
              stroke="var(--ui-border)"
              strokeDasharray="2 4"
            />
            <text x="34" y={y(v) + 4} textAnchor="end" fill="var(--ui-muted)" fontSize="11">
              {Number(v.toPrecision(3))}
            </text>
          </g>
        ))}
        {p.highlight && (
          <polygon
            data-highlight="probability"
            points={`${x(p.highlight.from)},200 ${points
              .filter((v: any) => v.x >= p.highlight.from && v.x <= p.highlight.to)
              .map((v: any) => `${x(v.x)},${y(v.y)}`)
              .join(" ")} ${x(p.highlight.to)},200`}
            fill="var(--ui-accent)"
            opacity=".18"
          />
        )}
        {p.references?.map((v: number) => (
          <line
            key={v}
            x1="40"
            x2="500"
            y1={y(v)}
            y2={y(v)}
            stroke="var(--ui-muted)"
            strokeDasharray="4 4"
          />
        ))}
        {p.kind === "scatter" ? (
          points.map((v: any, i: number) => (
            <circle key={i} cx={x(v.x)} cy={y(v.y)} r="3" fill="var(--ui-accent)" />
          ))
        ) : p.kind === "histogram" ? (
          points.map((v: any, i: number) => (
            <rect
              key={i}
              x={x(v.x)}
              y={y(v.y)}
              width={460 / Math.max(1, points.length) - 1}
              height={200 - y(v.y)}
              fill="var(--ui-accent)"
            />
          ))
        ) : (
          <polyline
            points={points.map((v: any) => `${x(v.x)},${y(v.y)}`).join(" ")}
            fill={p.kind === "area" ? "var(--ui-surface)" : "none"}
            stroke="var(--ui-accent)"
          />
        )}
        <text x="40" y="238">
          {p.xUnit} / {p.yUnit}
        </text>
      </svg>
      <details>
        <summary>View plot data</summary>
        <pre>{JSON.stringify(points, null, 2)}</pre>
      </details>
    </figure>
  );
}
function Clock({
  node,
  runtime,
  surfaceId,
}: Pick<ComponentViewProps, "node" | "runtime" | "surfaceId">) {
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const ticker = useRef<Ticker | undefined>(undefined);
  if (!ticker.current)
    ticker.current = new Ticker((v) =>
      Object.entries(v).forEach(([k, value]) => {
        runtime.setValue(surfaceId, `${node.props.path}/${k}`, value, node.scope);
      }),
    );
  useEffect(() => {
    const saved = runtime.read(surfaceId, node.props.path, node.scope) as any;
    if (saved?.$time !== undefined) {
      try {
        ticker.current?.restore({
          time: saved.$time,
          frame: saved.$frame ?? 0,
          speed: saved.speed ?? 1,
        });
      } catch {
        runtime.report({
          code: "TICKER_SNAPSHOT",
          message: "Saved clock values were invalid.",
          severity: "warning",
        });
      }
    }
  }, [runtime, surfaceId, node.props.path, node.scope]);
  useEffect(() => {
    const t = ticker.current!;
    t.playing = playing;
    let visible = true;
    const observer = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? false;
    });
    if (ref.current) observer.observe(ref.current);
    const id = setInterval(() => {
      t.visible = visible && !document.hidden;
      t.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
      t.step(1 / 30);
    }, 1000 / 30);
    return () => {
      clearInterval(id);
      observer.disconnect();
    };
  }, [playing]);
  useEffect(() => () => ticker.current?.dispose(), []);
  return (
    <div ref={ref} className="ui-gallery-controls">
      <button type="button" onClick={() => setPlaying(!playing)}>
        {playing ? "Pause" : "Play"}
      </button>
      <button type="button" onClick={() => ticker.current?.step(1 / 30, true)}>
        Step
      </button>
      <button
        type="button"
        onClick={() => {
          setPlaying(false);
          ticker.current?.reset();
        }}
      >
        Reset clock
      </button>
      <label>
        Speed
        <select
          defaultValue="1"
          onChange={(e) => {
            ticker.current!.speed = Number(e.target.value);
          }}
        >
          {[0.5, 1, 2, 4].map((v) => (
            <option key={v} value={v}>
              {v}×
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
function Simulation({
  node,
  runtime,
  surfaceId,
}: Pick<ComponentViewProps, "node" | "runtime" | "surfaceId">) {
  const p = node.props;
  const paramsKey = JSON.stringify(p.params);
  const model = React.useMemo(
    () => createSimulation(p.module, p.seed, JSON.parse(paramsKey)),
    [p.module, p.seed, paramsKey],
  );
  const [snap, setSnap] = useState(() => model.snapshot());
  const [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1);
  const target = useRef<HTMLElement>(null);
  const liveModel = useRef<ReturnType<typeof createSimulation> | undefined>(undefined);
  const history = useRef<{ step: number; prey: number; predators: number; meanTrait: number }[]>(
    [],
  );
  const publish = React.useCallback(
    (next: ReturnType<typeof model.snapshot>) => {
      setSnap(next);
      history.current = [
        ...history.current,
        {
          step: next.step,
          prey: next.metrics.prey!,
          predators: next.metrics.predators!,
          meanTrait: next.metrics.meanTrait!,
        },
      ].slice(-240);
      runtime.setValue(surfaceId, `/simulations/${node.id}`, next, node.scope);
    },
    [runtime, surfaceId, node.id, node.scope],
  );
  useEffect(() => {
    liveModel.current = model;
    history.current = [];
    const saved = runtime.read(surfaceId, `/simulations/${node.id}`, node.scope) as any;
    if (saved?.module === p.module && saved?.seed === p.seed) {
      try {
        model.restore(saved);
      } catch {
        runtime.report({
          code: "SIMULATION_SNAPSHOT",
          message: "Saved simulation state was invalid; showing its initial state.",
          severity: "warning",
        });
      }
    }
    setSnap(model.snapshot());
    setPlaying(false);
    return () => {
      liveModel.current = undefined;
      // StrictMode immediately remounts the effect; dispose only the abandoned lifetime.
      queueMicrotask(() => {
        if (liveModel.current !== model) model.dispose();
      });
    };
  }, [model, runtime, surfaceId, node.id, node.scope, p.module, p.seed]);
  useEffect(() => {
    if (!playing) return;
    let visible = true,
      steps = 0;
    const observer = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? false;
    });
    if (target.current) observer.observe(target.current);
    const id = setInterval(() => {
      if (!visible || document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches)
        return;
      const start = performance.now();
      let next = model.snapshot();
      for (let i = 0; i < speed; i++) {
        next = model.step();
        if (performance.now() - start > 12) break;
      }
      publish(next);
      if (++steps >= 2000) setPlaying(false);
    }, 50);
    return () => {
      clearInterval(id);
      observer.disconnect();
    };
  }, [playing, model, speed, publish]);
  return (
    <figure ref={target}>
      <figcaption>{p.title} — simplified trusted model</figcaption>
      <svg viewBox="0 0 500 300" role="img" aria-label={p.title}>
        {snap.particles.map((x, i) => (
          <circle
            key={i}
            cx={x.x * 500}
            cy={x.y * 300}
            r={p.module === "nBody" && i === 0 ? 8 : 3}
            fill={["var(--ui-accent)", "var(--ui-muted)", "var(--ui-foreground)"][x.kind]}
          />
        ))}
      </svg>
      <div className="ui-gallery-controls">
        <button type="button" onClick={() => setPlaying(!playing)}>
          {playing ? "Pause simulation" : "Play simulation"}
        </button>
        <button type="button" onClick={() => publish(model.step())}>
          Step simulation
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            history.current = [];
            publish(model.reset());
          }}
        >
          Reset simulation
        </button>
        <label>
          Simulation speed
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {[1, 2, 4, 8].map((v) => (
              <option key={v} value={v}>
                {v}×
              </option>
            ))}
          </select>
        </label>
        {p.module === "cellular" && (
          <button type="button" onClick={() => publish(model.pour(1))}>
            Pour water
          </button>
        )}
      </div>
      <p role="status">
        Step {snap.step}; {snap.metrics.count} particles; energy {snap.metrics.energy.toFixed(6)}
      </p>
      {p.module === "agents" && (
        <AdvancedChart
          p={{
            title: "Population history",
            kind: "line",
            values: history.current,
            xKey: "step",
            yKey: "prey",
            series: [
              { key: "prey", label: "Prey", color: "accent" },
              { key: "predators", label: "Predators", color: "foreground" },
              { key: "meanTrait", label: "Mean inherited trait", color: "muted" },
            ],
          }}
        />
      )}
      <p>
        Manual steps work with reduced motion. Continuous playback pauses outside the viewport. Work
        is capped to eight steps and a 12ms check between steps.
      </p>
    </figure>
  );
}

function AdvancedChart({ p }: { p: any }) {
  const values = (p.values ?? []).slice(-(p.window ?? 1000));
  const series = p.series?.length ? p.series : [{ key: p.yKey, label: p.title, color: "accent" }];
  const numbers =
    p.kind === "stacked"
      ? values.map((v: any) =>
          series.reduce((sum: number, s: any) => sum + Math.max(0, Number(v[s.key]) || 0), 0),
        )
      : values
          .flatMap((v: any) => series.map((s: any) => Number(v[s.key])))
          .filter(Number.isFinite);
  const transform = (v: number) => (p.scale === "log" ? Math.log10(v) : v);
  const valid = numbers.filter((v: number) => p.scale !== "log" || v > 0);
  const min = p.scale === "log" ? Math.min(...valid.map(transform)) : Math.min(0, ...valid),
    max = Math.max(min + 1, ...valid.map(transform));
  const y = (v: number) => 200 - ((transform(v) - min) / (max - min)) * 170,
    x = (i: number) => 40 + (i / Math.max(1, values.length - 1)) * 460;
  return (
    <figure className="ui-chart">
      <figcaption>{p.title}</figcaption>
      <svg viewBox="0 0 540 240" role="img" aria-label={p.title}>
        {p.bands?.map((b: any, i: number) => (
          <rect
            key={`band-${i}`}
            x="40"
            width="460"
            y={y(b.to)}
            height={Math.abs(y(b.from) - y(b.to))}
            fill="var(--ui-surface)"
          />
        ))}
        {p.references?.map((v: number) => (
          <line
            key={`reference-${v}`}
            x1="40"
            x2="500"
            y1={y(v)}
            y2={y(v)}
            stroke="var(--ui-muted)"
            strokeDasharray="4 4"
          />
        ))}
        {series.map((s: any, j: number) => {
          const points = values
            .map((v: any, i: number) => [x(i), y(Number(v[s.key]))])
            .filter((v: number[]) => v.every(Number.isFinite));
          return (
            <g key={s.key} stroke={color(s.color)} fill={color(s.color)}>
              {p.kind === "scatter" ? (
                points.map((v: number[], i: number) => <circle key={i} cx={v[0]} cy={v[1]} r="3" />)
              ) : ["bar", "histogram", "stacked"].includes(p.kind) ? (
                points.map((v: number[], i: number) => (
                  <rect
                    key={i}
                    x={v[0] + (p.kind === "stacked" ? 0 : j * 5)}
                    y={
                      p.kind === "stacked"
                        ? y(
                            series
                              .slice(0, j + 1)
                              .reduce(
                                (sum: number, t: any) =>
                                  sum + Math.max(0, Number(values[i][t.key]) || 0),
                                0,
                              ),
                          )
                        : v[1]
                    }
                    width={Math.max(1, 440 / Math.max(1, values.length) / series.length)}
                    height={
                      p.kind === "stacked"
                        ? Math.max(
                            0,
                            y(
                              series
                                .slice(0, j)
                                .reduce(
                                  (sum: number, t: any) =>
                                    sum + Math.max(0, Number(values[i][t.key]) || 0),
                                  0,
                                ),
                            ) -
                              y(
                                series
                                  .slice(0, j + 1)
                                  .reduce(
                                    (sum: number, t: any) =>
                                      sum + Math.max(0, Number(values[i][t.key]) || 0),
                                    0,
                                  ),
                              ),
                          )
                        : Math.max(0, 200 - v[1])
                    }
                  />
                ))
              ) : (
                <path
                  d={`${points.map((v: number[], i: number) => `${i ? "L" : "M"}${v.join(",")}`).join(" ")}${p.kind === "area" && points.length ? ` L${points.at(-1)![0]},200 L40,200 Z` : ""}`}
                  fill={p.kind === "area" ? color(s.color) : "none"}
                  fillOpacity="0.3"
                  strokeWidth="2"
                />
              )}
            </g>
          );
        })}
        <text x="40" y="238">
          {p.xUnit ?? p.xKey} / {p.yUnit ?? p.yKey} ({p.scale})
        </text>
      </svg>
      <ul className="ui-legend">
        {series.map((s: any) => (
          <li key={s.key}>{s.label}</li>
        ))}
      </ul>
      <details>
        <summary>데이터 표 보기</summary>
        <div className="ui-table-scroll">
          <table>
            <caption>{p.title}</caption>
            <thead>
              <tr>
                <th>{p.xUnit ?? p.xKey}</th>
                {series.map((s: any) => (
                  <th key={s.key}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {values.map((v: any, i: number) => (
                <tr key={i}>
                  <td>{v[p.xKey]}</td>
                  {series.map((s: any) => (
                    <td key={s.key}>{String(v[s.key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
