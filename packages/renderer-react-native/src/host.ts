// What a host adds to Live UIs (its own module: kit views read it too, without importing live.tsx).
import type React from "react";
import { createContext } from "react";

/** What a host adds to Live UIs: copying text and touch feedback. */
export type LiveHostServices = {
  copy?: (text: string) => void;
  haptic?: (kind: "light" | "selection") => void;
  /** sheet({…}) from a tap: the host opens a bottom sheet and fills it. */
  sheet?: (spec: Record<string, unknown>) => void;
  /** A map tile's address (z/x/y), or null when the host has no map. */
  mapTile?: (z: number, x: number, y: number) => string | null;
  /** <file path="…"/>: the host draws the file the answer handed over at that place. */
  renderFile?: (path: string, name?: string) => React.ReactNode;
};
export const LiveHost = createContext<LiveHostServices>({});
