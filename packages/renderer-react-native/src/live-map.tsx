// <map> in Meld Live: places on a map, drawn from raster tiles the host serves (the app's own
// server keeps them, so phones never reach the tile provider). It fits every pin in view, or
// centres the chosen one; dragging moves it, + and − zoom, and tapping a pin chooses it (the
// bound state then focuses it, so a list next to the map can move the map too).
import React, { useMemo, useRef, useState } from "react";
import { Animated, Image, PanResponder, Pressable, Text, View } from "react-native";

export type MapPin = { lat: number; lng: number; label?: string; color?: string };

const TILE = 256;
const clampZ = (z: number) => Math.max(2, Math.min(18, Math.round(z)));
const worldX = (lng: number, z: number) => ((lng + 180) / 360) * TILE * 2 ** z;
const worldY = (lat: number, z: number) => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
};

/** The zoom that shows every pin with some room around them. */
function fitZoom(pins: MapPin[], w: number, h: number): number {
  if (pins.length < 2) return 15;
  for (let z = 17; z >= 2; z--) {
    const xs = pins.map((p) => worldX(p.lng, z));
    const ys = pins.map((p) => worldY(p.lat, z));
    if (Math.max(...xs) - Math.min(...xs) <= w - 72 && Math.max(...ys) - Math.min(...ys) <= h - 72)
      return z;
  }
  return 2;
}

export function LiveMap({
  pins,
  selected,
  onSelect,
  zoom: askedZoom,
  center: askedCenter,
  height,
  tile,
  ink,
  accent,
  surface,
  muted,
  radius,
}: {
  pins: MapPin[];
  selected: number | null;
  onSelect?: (i: number) => void;
  zoom?: number;
  center?: { lat: number; lng: number };
  height: number;
  tile?: (z: number, x: number, y: number) => string | null;
  ink: string;
  accent: string;
  surface: string;
  muted: string;
  radius: number;
}) {
  const [w, setW] = useState(0);
  // The user's own moves (drag, + and −) on top of what the UI asks for; a new focus clears them.
  const [own, setOwn] = useState<{ key: string; dz: number; dx: number; dy: number }>({ key: "", dz: 0, dx: 0, dy: 0 });
  const focus = selected !== null && pins[selected] ? pins[selected] : null;
  const key = `${focus ? `${focus.lat},${focus.lng}` : ""}|${askedZoom ?? ""}|${askedCenter?.lat ?? ""}|${pins.length}`;
  const mine = own.key === key ? own : { key, dz: 0, dx: 0, dy: 0 };

  const base = useMemo(() => {
    if (!w) return null;
    const z0 = askedZoom !== undefined ? clampZ(askedZoom) : focus ? Math.max(15, fitZoom(pins, w, height)) : fitZoom(pins, w, height);
    let c = askedCenter ?? focus;
    if (!c) {
      const lats = pins.map((p) => p.lat);
      const lngs = pins.map((p) => p.lng);
      c = pins.length
        ? { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 }
        : { lat: 37.5665, lng: 126.978 };
    }
    return { z0, c };
  }, [w, height, askedZoom, askedCenter?.lat, askedCenter?.lng, focus?.lat, focus?.lng, pins]);

  const drag = useRef(new Animated.ValueXY()).current;
  const latest = useRef(mine);
  latest.current = mine;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 6,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: Animated.event([null, { dx: drag.x, dy: drag.y }], { useNativeDriver: false }),
        onPanResponderRelease: (_, g) => {
          const m = latest.current;
          setOwn({ ...m, dx: m.dx - g.dx, dy: m.dy - g.dy });
          drag.setValue({ x: 0, y: 0 });
        },
        onPanResponderTerminate: () => drag.setValue({ x: 0, y: 0 }),
      }),
    [drag],
  );

  let body: React.ReactNode = null;
  if (base && w) {
    const z = clampZ(base.z0 + mine.dz);
    const k = 2 ** (z - base.z0);
    // The centre in world pixels at z, moved by the user's drags (kept at the zoom they were made).
    const cx = worldX(base.c.lng, z) + mine.dx * k;
    const cy = worldY(base.c.lat, z) + mine.dy * k;
    const left = cx - w / 2;
    const top = cy - height / 2;
    const n = 2 ** z;
    const tiles: { x: number; y: number; uri: string }[] = [];
    // One tile of margin around the view, so a drag shows map instead of blank edges.
    for (let ty = Math.floor(top / TILE) - 1; ty <= Math.floor((top + height) / TILE) + 1; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor(left / TILE) - 1; tx <= Math.floor((left + w) / TILE) + 1; tx++) {
        const uri = tile?.(z, ((tx % n) + n) % n, ty);
        if (uri) tiles.push({ x: tx * TILE - left, y: ty * TILE - top, uri });
      }
    }
    body = (
      <Animated.View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, transform: drag.getTranslateTransform() }}>
        {tiles.map((t) => (
          <Image key={t.uri} source={{ uri: t.uri }} style={{ position: "absolute", left: t.x, top: t.y, width: TILE, height: TILE }} />
        ))}
        {pins.map((p, i) => {
          const x = worldX(p.lng, z) - left;
          const y = worldY(p.lat, z) - top;
          const on = i === selected;
          const color = p.color ?? accent;
          return (
            <Pressable
              // biome-ignore lint/suspicious/noArrayIndexKey: pins are in the order given
              key={i}
              onPress={onSelect ? () => onSelect(i) : undefined}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={p.label ?? `${i + 1}`}
              style={{ position: "absolute", left: x - 60, top: y - (on ? 46 : 38), width: 120, alignItems: "center", zIndex: on ? 2 : 1 }}
            >
              {p.label && (on || pins.length <= 6) ? (
                <View style={{ backgroundColor: on ? ink : surface, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 3, maxWidth: 120, elevation: 2, shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }}>
                  <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "600", color: on ? surface : ink }}>{p.label}</Text>
                </View>
              ) : null}
              <View style={{ width: on ? 20 : 16, height: on ? 20 : 16, borderRadius: 10, backgroundColor: color, borderWidth: 3, borderColor: "#fff", elevation: 3, shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }} />
            </Pressable>
          );
        })}
      </Animated.View>
    );
  }

  const zoomBy = (d: number) => setOwn({ ...mine, dz: Math.max(-14, Math.min(14, mine.dz + d)), dx: mine.dx, dy: mine.dy });
  return (
    <View
      onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}
      style={{ width: "100%", height, borderRadius: radius, overflow: "hidden", backgroundColor: "#E8EAED" }}
      {...pan.panHandlers}
      accessibilityLabel={`지도${pins.length ? `, 장소 ${pins.length}곳` : ""}`}
    >
      {body}
      <View style={{ position: "absolute", right: 8, top: 8, borderRadius: 10, backgroundColor: surface, overflow: "hidden", elevation: 2 }}>
        {[1, -1].map((d) => (
          <Pressable key={d} onPress={() => zoomBy(d)} accessibilityLabel={d > 0 ? "확대" : "축소"} style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 20, lineHeight: 22, color: ink }}>{d > 0 ? "+" : "−"}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={{ position: "absolute", right: 6, bottom: 3, fontSize: 9, color: muted }}>© OpenStreetMap</Text>
    </View>
  );
}

/** Pins from what a model wrote: [{lat, lng, label}] (also latitude/longitude, or [lat, lng]). */
export function readPins(v: unknown): MapPin[] {
  if (!Array.isArray(v)) return [];
  const out: MapPin[] = [];
  for (const p of v.slice(0, 60)) {
    const o = (Array.isArray(p) ? { lat: p[0], lng: p[1], label: p[2] } : p) as Record<string, unknown> | null;
    if (!o || typeof o !== "object") continue;
    const lat = Number(o.lat ?? o.latitude);
    const lng = Number(o.lng ?? o.lon ?? o.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) continue;
    out.push({
      lat,
      lng,
      ...(o.label ?? o.title ?? o.name ? { label: String(o.label ?? o.title ?? o.name).slice(0, 40) } : {}),
      ...(typeof o.color === "string" ? { color: o.color } : {}),
    });
  }
  return out;
}
