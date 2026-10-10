import type { UIRuntime } from "@engine/core";
import { editorial } from "@engine/kit-editorial";
import { neutral } from "@engine/kit-neutral";
import { CATALOG_ID } from "@engine/protocol";
import { createUIRuntime, UIProvider, UISurface } from "@engine/renderer-react-native";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import fixtures from "../../fixtures/cases.json";
import { gcCounters, summarize } from "./stats";

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const settle = async () => {
  await frame();
  await frame();
  await frame();
};
class Guard extends React.Component<
  { children: React.ReactNode; fail: (error: Error) => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.fail(error);
  }
  render() {
    return this.state.failed ? <Text>렌더링 실패</Text> : this.props.children;
  }
}
/** Offline, on-device validation harness belonging to the demo app only. */
export function Verification({ close }: { close: () => void }) {
  const [view, setView] = useState<{ runtime: UIRuntime; kit: typeof neutral; id: number } | null>(
    null,
  );
  const [status, setStatus] = useState("SDK 검증 중");
  const [finished, setFinished] = useState(false);
  const [report, setReport] = useState("");
  const renderError = useRef<Error | null>(null);
  const pending = useRef<{
    start: number;
    resolve: (time: number) => void;
    reject: (error: Error) => void;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    let current: UIRuntime | undefined;
    let id = 0;
    const show = async (runtime: UIRuntime, kit: typeof neutral) => {
      const old = current;
      current = runtime;
      setView({ runtime, kit, id: ++id });
      await settle();
      old?.dispose();
      if (!alive) throw Error("VERIFICATION_CANCELLED");
    };
    const run = async () => {
      for (const kit of [neutral, editorial])
        for (const fixture of fixtures) {
          const runtime = createUIRuntime();
          await show(runtime, kit);
          for (const message of fixture.messages) runtime.accept(message);
          runtime.finish();
          await settle();
          const invalid = runtime.surfaceIds.flatMap((sid) =>
            [...runtime.getSurface(sid)!.componentsModel.values].filter(
              (node) => runtime.getNodeSnapshot(sid, node.id).error,
            ),
          );
          if (runtime.diagnostics.length || invalid.length || renderError.current)
            throw Error(`${kit.id}/${fixture.id}: INVALID_FIXTURE`);
        }
      // Two conditions, 130 samples each (10 warm-ups dropped, 120 kept):
      //  cold-tree: a fresh runtime and a freshly mounted tree for every sample
      //  warm:      one mounted tree and runtime; each sample deletes then recreates the surface
      const SAMPLES = 130;
      const DROP = 10;
      const content = () => [
        {
          id: "root",
          component: "Column",
          children: Array.from({ length: 99 }, (_, i) => `n${i}`),
        },
        ...Array.from({ length: 99 }, (_, i) => ({
          id: `n${i}`,
          component: "Text",
          text: `측정 ${i}`,
        })),
      ];
      const measure = async (runtime: UIRuntime) => {
        // JS-thread liveness: a 4 ms timer whose worst lateness tells JS stalls from native delays.
        let last = performance.now();
        let worstLag = 0;
        const lagTimer = setInterval(() => {
          const now = performance.now();
          worstLag = Math.max(worstLag, now - last - 4);
          last = now;
        }, 4);
        const elapsed = new Promise<number>((resolve, reject) => {
          const timeout = setTimeout(() => {
            pending.current = null;
            reject(Error("LAYOUT_TIMEOUT"));
          }, 5000);
          pending.current = {
            start: performance.now(),
            resolve: (time) => {
              clearTimeout(timeout);
              resolve(time);
            },
            reject,
          };
        });
        const gcBefore = gcCounters();
        const t0 = performance.now();
        runtime.accept({
          version: "v0.9",
          updateComponents: { surfaceId: "main", components: content() },
        });
        const acceptMs = performance.now() - t0;
        const total = await elapsed;
        clearInterval(lagTimer);
        const gcAfter = gcCounters();
        return {
          worstJsLagMs: worstLag,
          total,
          acceptMs,
          layoutMs: total - acceptMs,
          gcCount: gcBefore && gcAfter ? gcAfter.collections - gcBefore.collections : null,
          gcMs: gcBefore && gcAfter ? gcAfter.wallMs - gcBefore.wallMs : null,
          heapBytes: gcAfter?.heapBytes ?? null,
          statKeys: gcAfter ? Object.keys(gcAfter.raw) : null,
        };
      };
      type Sample = Awaited<ReturnType<typeof measure>>;
      const condition = (kept: Sample[]) => ({
        ...summarize(kept.map((k) => k.total)),
        // Arrival order (the sorted list loses it): lets periodic stalls show up.
        sequenceMs: kept.map((k) => Math.round(k.total)),
        jsLagSequenceMs: kept.map((k) => Math.round(k.worstJsLagMs)),
        gcMsSequence: kept.map((k) => (k.gcMs == null ? null : Math.round(k.gcMs))),
        gcCountSequence: kept.map((k) => k.gcCount),
        heapBytesSequence: kept.map((k) => k.heapBytes),
        hermesStatKeys: kept[0]?.statKeys ?? null,
        phases: {
          acceptMs: { ...summarize(kept.map((k) => k.acceptMs)), timingsMs: undefined },
          layoutMs: { ...summarize(kept.map((k) => k.layoutMs)), timingsMs: undefined },
        },
        gc:
          kept[0]?.gcCount == null
            ? "unavailable"
            : {
                collectionsTotal: kept.reduce((n, k) => n + (k.gcCount ?? 0), 0),
                samplesWithGc: kept.filter((k) => (k.gcCount ?? 0) > 0).length,
                gcMsTotal: kept.reduce((n, k) => n + (k.gcMs ?? 0), 0),
                // Slow samples (> p95) and whether a collection ran inside them.
                slowWithGc: kept
                  .filter((k) => k.total > summarize(kept.map((x) => x.total)).p95)
                  .map((k) => (k.gcCount ?? 0) > 0),
              },
      });
      const coldSamples: Sample[] = [];
      for (let sample = 0; sample < SAMPLES; sample++) {
        const runtime = createUIRuntime();
        runtime.accept({
          version: "v0.9",
          createSurface: { surfaceId: "main", catalogId: CATALOG_ID },
        });
        await show(runtime, neutral);
        const result = await measure(runtime);
        if (sample >= DROP) coldSamples.push(result);
        await settle();
      }
      const warmRuntime = createUIRuntime();
      await show(warmRuntime, neutral);
      const warmSamples: Sample[] = [];
      for (let sample = 0; sample < SAMPLES; sample++) {
        if (warmRuntime.getSurface("main"))
          warmRuntime.accept({ version: "v0.9", deleteSurface: { surfaceId: "main" } });
        await settle();
        warmRuntime.accept({
          version: "v0.9",
          createSurface: { surfaceId: "main", catalogId: CATALOG_ID },
        });
        await settle();
        const result = await measure(warmRuntime);
        if (sample >= DROP) warmSamples.push(result);
      }
      const warm = condition(warmSamples);
      const cold = condition(coldSamples);
      const result = {
        platform: "react-native",
        mode: "release",
        fixtures: 60,
        nodes: 100,
        warmupDropped: DROP,
        cold,
        warm,
        // Legacy fields (cold-tree, the original definition) so older readers keep working.
        samples: cold.samples,
        p95Ms: cold.p95,
        timingsMs: cold.timingsMs,
      };
      console.log(`ENGINE_PERFORMANCE ${JSON.stringify(result)}`);
      if (alive) {
        setReport(JSON.stringify(result));
        setStatus(
          `SDK 검증 통과 · 60/60 · cold p95 ${cold.p95.toFixed(1)}ms · warm p95 ${warm.p95.toFixed(1)}ms`,
        );
        setFinished(true);
      }
    };
    void run().catch((error) => {
      if (alive) {
        setStatus(`SDK 검증 실패: ${String(error)}`);
        setFinished(true);
      }
    });
    return () => {
      alive = false;
      current?.dispose();
      pending.current?.reject(Error("VERIFICATION_CANCELLED"));
      pending.current = null;
    };
  }, []);
  return (
    <SafeAreaView style={{ flex: 1, padding: 18, backgroundColor: "#f5f7fa" }}>
      <Text accessibilityLiveRegion="polite" style={{ fontSize: 18, color: "#172a40" }}>
        {status}
      </Text>
      {report && (
        <Text
          testID="verification-report"
          accessibilityLabel={report}
          style={{ color: "#172a40", fontSize: 12 }}
        >
          100 nodes · 120 cold + 120 warm samples · native layout event
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={close}
        disabled={!finished}
        style={{ padding: 16 }}
      >
        <Text>검증 닫기</Text>
      </Pressable>
      <ScrollView>
        {view && (
          <Guard
            key={view.id}
            fail={(error) => {
              renderError.current = error;
              pending.current?.reject(error);
            }}
          >
            <View
              onLayout={() => {
                const job = pending.current;
                if (job) {
                  pending.current = null;
                  job.resolve(performance.now() - job.start);
                }
              }}
            >
              <UIProvider runtime={view.runtime} kit={view.kit}>
                <UISurface />
              </UIProvider>
            </View>
          </Guard>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
