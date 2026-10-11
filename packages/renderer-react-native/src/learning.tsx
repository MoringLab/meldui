// biome-ignore-all lint/suspicious/noArrayIndexKey: bounded stateless SVG vertices and fixed semantic entries use ordinal positions
import { formatStat, routePoints, sceneShapes, Ticker } from "@engine/core";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  G,
  Line,
  LinearGradient,
  Path,
  Polygon,
  Polyline,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import { SafeMarkdown } from "./markdown.js";
import type { NativeViewProps } from "./renderer.js";
import { NativeIcon, useUI } from "./renderer.js";
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
  "RouteMap",
  "Simulation",
];
const tags: Record<string, any> = {
  group: G,
  rect: Rect,
  circle: Circle,
  ellipse: Ellipse,
  line: Line,
  polyline: Polyline,
  polygon: Polygon,
  path: Path,
  text: SvgText,
};
export function LearningView({ node, children, runtime, surfaceId }: NativeViewProps) {
  const { kit, mode } = useUI();
  const t = kit.tokens[mode],
    p = node.props;
  const [selected, setSelected] = useState(Number(p.value ?? 0));
  useEffect(() => setSelected(Number(p.value ?? 0)), [p.value]);
  const text = (value: any) => (
    <Text style={{ color: t.foreground, fontSize: kit.tokens.typography.baseSize }}>
      {String(value ?? "")}
    </Text>
  );
  const button = (label: string, click: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={click}
      style={{
        minHeight: 48,
        padding: 12,
        borderWidth: 1,
        borderColor: t.border,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {text(label)}
    </Pressable>
  );
  const choose = (v: number) => {
    setSelected(v);
    const path = (node.raw?.value as any)?.path;
    if (path) runtime.setValue(surfaceId, path, v, node.scope);
  };
  switch (node.component) {
    case "Confirmation":
      return (
        <View>
          {text(p.title)}
          {text(p.detail)}
          {button(p.label, () => void runtime.dispatch(surfaceId, node.id, p.action, node.scope))}
        </View>
      );
    case "ControlPanel":
      return (
        <View style={{ gap: 16 }}>
          {p.title && text(p.title)}
          {children}
        </View>
      );
    case "StatGroup":
      return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>{children}</View>;
    case "Stat":
      // A label above a prominent value: the value is what changes when controls move.
      return (
        <View accessibilityLiveRegion="polite" style={{ gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {p.icon ? <NativeIcon name={p.icon} size={16} color={t.muted} /> : null}
            <Text style={{ color: t.muted, fontSize: kit.tokens.typography.baseSize * 0.87 }}>
              {String(p.label ?? "")}
            </Text>
          </View>
          <Text
            style={{
              color: t.foreground,
              fontSize: kit.tokens.typography.baseSize * 1.47,
              fontWeight: "700",
              fontVariant: ["tabular-nums"],
            }}
          >
            {`${formatStat(p.value, p.precision)}${p.unit ? ` ${p.unit}` : ""}`}
          </Text>
        </View>
      );
    case "Legend":
      return (
        <View>
          {p.items.map((x: any, i: number) => (
            <View key={i}>{text(x.label)}</View>
          ))}
        </View>
      );
    case "Formula":
      return (
        <View>
          <SafeMarkdown text={`$$\n${p.latex}\n$$`} />
          {text(p.meaning)}
        </View>
      );
    case "Annotation":
      return text(p.text);
    case "Walkthrough":
      return (
        <View style={{ gap: 12 }}>
          {text(p.steps[selected]?.title)}
          {text(p.steps[selected]?.text)}
          {button("Previous step", () => choose(selected - 1), selected === 0)}
          {button("Next step", () => choose(selected + 1), selected >= p.steps.length - 1)}
        </View>
      );
    case "Quiz":
      return (
        <View style={{ gap: 12 }}>
          {text(p.prompt)}
          {p.choices.map((choice: string, i: number) => (
            <View key={i}>{button(choice, () => choose(i))}</View>
          ))}
          {selected >= 0 &&
            text(`${selected === p.correctIndex ? "Correct." : "Try again."} ${p.explanation}`)}
        </View>
      );
    case "Timeline":
      return (
        <View>
          {p.items.map((x: any, i: number) => (
            <View key={i}>
              {text(x.label)}
              {text(x.detail)}
              {x.action &&
                button(
                  `Open ${x.label}`,
                  () => void runtime.dispatch(surfaceId, node.id, x.action, node.scope),
                )}
            </View>
          ))}
        </View>
      );
    case "Playback":
      return <ManualClock {...{ node, runtime, surfaceId }} />;
    case "Simulation":
      return text(`${p.title}: simulation requires the web renderer. ${p.module}, seed ${p.seed}.`);
    case "RouteMap": {
      const points = routePoints(p.points);
      return (
        <View>
          {text(`${p.title} — approximate schematic`)}
          <Svg width="100%" height={260} viewBox="0 0 500 300">
            <Polyline
              points={points.map((x) => `${x.x},${x.y}`).join(" ")}
              fill="none"
              stroke={t.accent}
            />
            {points.map((x, i) => (
              <G key={i}>
                <Circle cx={x.x} cy={x.y} r={5} fill={t.accent} />
                <SvgText x={x.x + 8} y={x.y} fill={t.foreground}>
                  {x.label}
                </SvgText>
              </G>
            ))}
          </Svg>
          {p.verifyAction &&
            button(
              "Verify locations",
              () => void runtime.dispatch(surfaceId, node.id, p.verifyAction, node.scope),
            )}
        </View>
      );
    }
    case "SvgScene": {
      const prefix = `scene-${surfaceId.replace(/[^A-Za-z0-9_-]/g, "_")}-${node.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
      const shapes = sceneShapes(p.nodes, runtime, surfaceId, node.scope);
      const root: React.ReactNode[] = [];
      const stack: { attrs: any; children: React.ReactNode[] }[] = [{ attrs: {}, children: root }];
      shapes.forEach((s, i) => {
        const attrs = { ...s.attrs };
        if (attrs.clipId) {
          attrs.clipPath = `url(#${prefix}-clip-${attrs.clipId})`;
          delete attrs.clipId;
        }
        if (String(attrs.fill).startsWith("gradient:"))
          attrs.fill = `url(#${prefix}-${String(attrs.fill).slice(9)})`;
        for (const key of ["fill", "stroke"])
          if (typeof attrs[key] === "string" && attrs[key] in t)
            attrs[key] = (t as any)[attrs[key]];
        if (s.type === "group") {
          stack.push({
            attrs: {
              ...attrs,
              onPress: s.action
                ? () => void runtime.dispatch(surfaceId, node.id, s.action as any, node.scope)
                : undefined,
            },
            children: [],
          });
        } else if (s.type === "group-end") {
          const x = stack.pop()!;
          stack.at(-1)!.children.push(
            <G key={i} {...x.attrs}>
              {x.children}
            </G>,
          );
        } else {
          const Tag = tags[s.type];
          stack.at(-1)!.children.push(
            <Tag
              key={i}
              {...attrs}
              onPress={
                s.action || s.onHover
                  ? () =>
                      void runtime.dispatch(
                        surfaceId,
                        node.id,
                        (s.action ?? s.onHover) as any,
                        node.scope,
                      )
                  : undefined
              }
            >
              {s.type === "text" ? s.text : undefined}
            </Tag>,
          );
        }
      });
      return (
        <View>
          {text(p.title)}
          <Svg
            accessibilityLabel={p.description}
            width="100%"
            height={280}
            viewBox={p.viewBox.join(" ")}
          >
            <Defs>
              {p.gradients?.map((g: any) => (
                <LinearGradient id={`${prefix}-${g.id}`} key={g.id}>
                  {g.stops.map((stop: any) => (
                    <Stop
                      key={stop.offset}
                      offset={stop.offset}
                      stopColor={t[stop.color as keyof typeof t] ?? stop.color}
                    />
                  ))}
                </LinearGradient>
              ))}
              {p.clips?.map((clip: any) => (
                <ClipPath id={`${prefix}-clip-${clip.id}`} key={clip.id}>
                  <Rect x={clip.x} y={clip.y} width={clip.width} height={clip.height} />
                </ClipPath>
              ))}
            </Defs>
            {root}
          </Svg>
          {text(p.description)}
        </View>
      );
    }
    case "Plot": {
      const points = (p.values ?? []).map((v: any, i: number) => ({
        x:
          typeof v === "number"
            ? p.domain
              ? p.domain[0] + (i * (p.domain[1] - p.domain[0])) / Math.max(1, p.values.length - 1)
              : i
            : v[p.xKey],
        y: typeof v === "number" ? v : v[p.yKey],
      }));
      const xs = points.map((v: any) => v.x),
        ys = points.map((v: any) => v.y);
      const min = Math.min(0, ...ys),
        max = Math.max(1, ...ys),
        xmin = Math.min(0, ...xs),
        xmax = Math.max(1, ...xs);
      const mapped = points
        .filter((v: any) => Number.isFinite(v.x) && Number.isFinite(v.y))
        .map((v: any) => ({
          x: 30 + ((v.x - xmin) / (xmax - xmin)) * 440,
          y: 200 - ((v.y - min) / (max - min)) * 180,
        }));
      return (
        <View>
          {text(p.title)}
          <Svg accessibilityLabel={p.title} width="100%" height={240} viewBox="0 0 500 240">
            {p.references?.map((v: number) => (
              <Line
                key={v}
                x1={30}
                x2={470}
                y1={200 - ((v - min) / (max - min)) * 180}
                y2={200 - ((v - min) / (max - min)) * 180}
                stroke={t.muted}
              />
            ))}
            {p.kind === "scatter" ? (
              mapped.map((v: any, i: number) => (
                <Circle key={i} cx={v.x} cy={v.y} r={3} fill={t.accent} />
              ))
            ) : p.kind === "histogram" ? (
              mapped.map((v: any, i: number) => (
                <Rect
                  key={i}
                  x={v.x}
                  y={Math.min(200, v.y)}
                  width={Math.max(1, 440 / Math.max(1, mapped.length) - 1)}
                  height={Math.abs(200 - v.y)}
                  fill={t.accent}
                />
              ))
            ) : (
              <Polyline
                fill={p.kind === "area" ? t.surface : "none"}
                stroke={t.accent}
                points={[
                  ...(p.kind === "area" ? [{ x: 30, y: 200 }] : []),
                  ...mapped,
                  ...(p.kind === "area" ? [{ x: 470, y: 200 }] : []),
                ]
                  .map((v: any) => `${v.x},${v.y}`)
                  .join(" ")}
              />
            )}
          </Svg>
          {text(`${p.xUnit ?? ""} / ${p.yUnit ?? ""}`)}
          {text(JSON.stringify(points))}
        </View>
      );
    }

    default:
      return null;
  }
}
function ManualClock({
  node,
  runtime,
  surfaceId,
}: Pick<NativeViewProps, "node" | "runtime" | "surfaceId">) {
  const t = useRef<Ticker | undefined>(undefined);
  if (!t.current)
    t.current = new Ticker((values) =>
      Object.entries(values).forEach(([key, value]) => {
        runtime.setValue(surfaceId, `${node.props.path}/${key}`, value, node.scope);
      }),
    );
  useEffect(() => {
    const saved = runtime.read(surfaceId, node.props.path, node.scope) as any;
    if (saved?.$time !== undefined) {
      try {
        t.current?.restore({
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
  useEffect(() => () => t.current?.dispose(), []);
  const { kit, mode } = useUI();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
      {["Step", "Reset clock"].map((label, i) => (
        <Pressable
          key={label}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={{ minHeight: 48, padding: 12 }}
          onPress={() => (i === 0 ? t.current!.step(1 / 30, true) : t.current!.reset())}
        >
          <Text style={{ color: kit.tokens[mode].foreground }}>{label}</Text>
        </Pressable>
      ))}
      <Text style={{ color: kit.tokens[mode].muted }}>
        Manual clock (continuous playback requires host visibility control)
      </Text>
    </View>
  );
}
