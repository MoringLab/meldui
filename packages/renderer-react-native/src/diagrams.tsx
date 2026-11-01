import React, { useState } from "react";
import { Pressable, Text, View, type TextStyle } from "react-native";
import Svg, { Line, Path } from "react-native-svg";
import { NativeIcon } from "./renderer.js";

// Diagrams a phone reads better as a list of shapes than as boxes and arrows: drawn with views, so
// they never overlap or shrink to fit, and every node takes a tap.

export type KindNode = { id: string; label: string; sub?: string; detail?: string; icon?: string; color: string; x?: number; y?: number; parent?: string };
export type KindEdge = { from: string; to: string; label?: string; style?: string };
type Look = { t: { foreground: string; muted: string; surface: string; border: string; background: string }; body: TextStyle; alpha: (c: string, a: number) => string };
type Props = {
  kind: string;
  nodes: KindNode[];
  edges: KindEdge[];
  width: number;
  look: Look;
  selected?: string;
  onSelect: (id: string) => void;
};

function Tag({ n, look, on, onSelect, style, center }: { n: KindNode; look: Look; on: boolean; onSelect: (id: string) => void; style?: object; center?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={n.sub ? `${n.label}, ${n.sub}` : n.label}
      accessibilityState={{ selected: on }}
      onPress={() => onSelect(n.id)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: center ? "center" : "flex-start",
        gap: 8,
        paddingVertical: 9,
        paddingHorizontal: 12,
        borderRadius: 14,
        backgroundColor: look.alpha(n.color, on ? 0.22 : 0.11),
        borderWidth: on ? 1.5 : 0,
        borderColor: n.color,
        opacity: pressed ? 0.75 : 1,
        ...style,
      })}
    >
      {n.icon ? <NativeIcon name={n.icon} size={18} color={n.color} /> : null}
      <View style={{ flexShrink: 1, alignItems: center ? "center" : "flex-start" }}>
        <Text style={{ ...look.body, fontSize: 15, lineHeight: 20, fontWeight: "600", color: n.color, textAlign: center ? "center" : "left" }}>{n.label}</Text>
        {n.sub ? <Text style={{ ...look.body, fontSize: 13, lineHeight: 18, color: look.t.muted, textAlign: center ? "center" : "left" }}>{n.sub}</Text> : null}
      </View>
    </Pressable>
  );
}

/** Events down a line: a dot for each, the words beside it. */
function TimelineKind({ nodes, look, selected, onSelect }: Props) {
  return (
    <View>
      {nodes.map((n, i) => (
        <View key={n.id} style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ width: 14, alignItems: "center" }}>
            <View style={{ width: 2, height: 16, backgroundColor: i ? look.alpha(look.t.muted, 0.3) : "transparent" }} />
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: n.color }} />
            <View style={{ width: 2, flex: 1, backgroundColor: i < nodes.length - 1 ? look.alpha(look.t.muted, 0.3) : "transparent" }} />
          </View>
          <Pressable onPress={() => onSelect(n.id)} accessibilityRole="button" accessibilityState={{ selected: selected === n.id }} style={{ flex: 1, paddingVertical: 8 }}>
            {n.sub ? <Text style={{ ...look.body, fontSize: 13, lineHeight: 18, color: n.color, fontWeight: "600" }}>{n.sub}</Text> : null}
            <Text style={{ ...look.body, fontSize: 15, lineHeight: 21 }}>{n.label}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

/** Levels stacked on one another (an architecture); edges with a label read between them. */
function LayersKind({ nodes, edges, look, selected, onSelect }: Props) {
  return (
    <View style={{ gap: 6 }}>
      {nodes.map((n, i) => {
        const next = nodes[i + 1];
        const link = next ? edges.find((e) => e.from === n.id && e.to === next.id) : undefined;
        return (
          <View key={n.id} style={{ gap: 6 }}>
            <Tag n={n} look={look} on={selected === n.id} onSelect={onSelect} center />
            {link ? (
              <View style={{ alignItems: "center" }}>
                <NativeIcon name="arrow-down" size={14} color={look.t.muted} />
                {link.label ? <Text style={{ ...look.body, fontSize: 12, lineHeight: 16, color: look.t.muted }}>{link.label}</Text> : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** Each stage narrower than the last. */
function FunnelKind({ nodes, look, selected, onSelect }: Props) {
  return (
    <View style={{ gap: 5, alignItems: "center" }}>
      {nodes.map((n, i) => (
        <Tag key={n.id} n={n} look={look} on={selected === n.id} onSelect={onSelect} center style={{ width: `${100 - (i * 52) / Math.max(1, nodes.length - 1)}%` }} />
      ))}
    </View>
  );
}

/** The centre on top, a card for each branch and what hangs off it as chips. */
function MindmapKind({ nodes, edges, look, selected, onSelect }: Props) {
  const has = new Set(edges.map((e) => e.to));
  const root = nodes.find((n) => !has.has(n.id)) ?? (nodes[0] as KindNode);
  const kids = (id: string) => edges.filter((e) => e.from === id).map((e) => nodes.find((n) => n.id === e.to)).filter((n): n is KindNode => !!n);
  return (
    <View style={{ gap: 8 }}>
      <Tag n={root} look={look} on={selected === root.id} onSelect={onSelect} center />
      {kids(root.id).map((branch) => (
        <View key={branch.id} style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ width: 3, borderRadius: 2, backgroundColor: branch.color }} />
          <View style={{ flex: 1, gap: 6 }}>
            <Pressable onPress={() => onSelect(branch.id)} accessibilityRole="button" accessibilityState={{ selected: selected === branch.id }}>
              <Text style={{ ...look.body, fontSize: 15, lineHeight: 21, fontWeight: "600", color: branch.color }}>{branch.label}</Text>
              {branch.sub ? <Text style={{ ...look.body, fontSize: 13, lineHeight: 18, color: look.t.muted }}>{branch.sub}</Text> : null}
            </Pressable>
            {kids(branch.id).length ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {kids(branch.id).map((leaf) => (
                  <Pressable key={leaf.id} onPress={() => onSelect(leaf.id)} accessibilityRole="button" style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: look.alpha(branch.color, selected === leaf.id ? 0.24 : 0.1) }}>
                    <Text style={{ ...look.body, fontSize: 13, lineHeight: 18 }}>{leaf.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const ROW_H = 46;

/** Who says what to whom, in order: a lifeline for each node, an arrow for each edge. */
function SequenceKind({ nodes, edges, width, look, selected, onSelect }: Props) {
  const col = width / nodes.length;
  const at = (id: string) => nodes.findIndex((n) => n.id === id);
  const height = edges.length * ROW_H + 10;
  return (
    <View>
      <View style={{ flexDirection: "row" }}>
        {nodes.map((n) => (
          <View key={n.id} style={{ width: col, paddingHorizontal: 3 }}>
            <Tag n={n} look={look} on={selected === n.id} onSelect={onSelect} center style={{ paddingHorizontal: 4 }} />
          </View>
        ))}
      </View>
      <View style={{ height }}>
        <Svg width={width} height={height} style={{ position: "absolute" }}>
          {nodes.map((n, i) => (
            <Line key={n.id} x1={col * (i + 0.5)} x2={col * (i + 0.5)} y1={0} y2={height} stroke={look.alpha(look.t.muted, 0.3)} strokeWidth={1.5} strokeDasharray="4 5" />
          ))}
          {edges.map((e, i) => {
            const a = col * (at(e.from) + 0.5);
            const b = col * (at(e.to) + 0.5);
            const y = i * ROW_H + 36;
            const dir = b >= a ? 1 : -1;
            const color = nodes[at(e.from)]?.color ?? look.t.muted;
            return (
              <React.Fragment key={`${e.from}-${e.to}-${i}`}>
                <Line x1={a} x2={b} y1={y} y2={y} stroke={color} strokeWidth={1.8} strokeDasharray={e.style === "dashed" ? "6 5" : undefined} />
                <Path d={`M${b},${y} l${-8 * dir},-5 l0,10 Z`} fill={color} />
              </React.Fragment>
            );
          })}
        </Svg>
        {edges.map((e, i) => {
          const a = col * (at(e.from) + 0.5);
          const b = col * (at(e.to) + 0.5);
          const left = Math.min(a, b);
          return e.label ? (
            <Text key={`${e.from}-${e.to}-${i}-l`} numberOfLines={2} style={{ ...look.body, position: "absolute", left: left + 4, width: Math.max(Math.abs(b - a) - 8, col - 8), top: i * ROW_H + 2, fontSize: 12, lineHeight: 16, color: look.t.foreground, textAlign: "center" }}>
              {e.label}
            </Text>
          ) : null;
        })}
      </View>
    </View>
  );
}

/** Two axes (x and y, 0–100), a dot and a name for each node. */
function QuadrantKind({ nodes, width, look, selected, onSelect }: Props) {
  const height = Math.round(width * 0.8);
  return (
    <View style={{ width, height, borderRadius: 14, overflow: "hidden", backgroundColor: look.alpha(look.t.muted, 0.08) }}>
      <View style={{ position: "absolute", left: width / 2, top: 0, bottom: 0, width: 1, backgroundColor: look.alpha(look.t.muted, 0.3) }} />
      <View style={{ position: "absolute", top: height / 2, left: 0, right: 0, height: 1, backgroundColor: look.alpha(look.t.muted, 0.3) }} />
      {nodes.map((n) => {
        const x = ((n.x ?? 50) / 100) * width;
        const y = height - ((n.y ?? 50) / 100) * height;
        const right = x > width * 0.6;
        return (
          <Pressable key={n.id} onPress={() => onSelect(n.id)} accessibilityRole="button" accessibilityState={{ selected: selected === n.id }}
            style={{ position: "absolute", top: Math.max(2, Math.min(height - 24, y - 11)), ...(right ? { right: width - x - 6 } : { left: x - 6 }), flexDirection: right ? "row-reverse" : "row", alignItems: "center", gap: 5, maxWidth: width * 0.55 }}>
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: n.color, borderWidth: selected === n.id ? 2 : 0, borderColor: look.t.foreground }} />
            <Text numberOfLines={1} style={{ ...look.body, flexShrink: 1, fontSize: 13, lineHeight: 18 }}>{n.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const KINDS: Record<string, (p: Props) => React.ReactElement> = {
  timeline: TimelineKind,
  layers: LayersKind,
  funnel: FunnelKind,
  mindmap: MindmapKind,
  sequence: SequenceKind,
  quadrant: QuadrantKind,
};

export const hasKind = (kind: string | undefined) => !!kind && kind in KINDS;

export function DiagramKind(props: Props) {
  const Kind = KINDS[props.kind] as (p: Props) => React.ReactElement;
  return <Kind {...props} />;
}
