import type { UIRuntime } from "@engine/core";
import { editorial } from "@engine/kit-editorial";
import { neutral } from "@engine/kit-neutral";
import { CATALOG_ID } from "@engine/protocol";
import { createUIRuntime, UIProvider, UISurface } from "@engine/renderer-react-native";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import fixtures from "../../fixtures/cases.json";

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
      const times: number[] = [];
      for (let sample = 0; sample < 35; sample++) {
        const runtime = createUIRuntime();
        runtime.accept({
          version: "v0.9",
          createSurface: { surfaceId: "main", catalogId: CATALOG_ID },
        });
        await show(runtime, neutral);
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
        runtime.accept({
          version: "v0.9",
          updateComponents: {
            surfaceId: "main",
            components: [
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
            ],
          },
        });
        const ms = await elapsed;
        if (sample >= 5) times.push(ms);
        await settle();
      }
      times.sort((a, b) => a - b);
      const result = {
        platform: "react-native",
        mode: "release",
        fixtures: 60,
        nodes: 100,
        samples: times.length,
        p95Ms: times[Math.ceil(times.length * 0.95) - 1],
        timingsMs: times,
      };
      console.log(`ENGINE_PERFORMANCE ${JSON.stringify(result)}`);
      if (alive) {
        setReport(JSON.stringify(result));
        setStatus(`SDK 검증 통과 · 60/60 · p95 ${result.p95Ms.toFixed(1)}ms`);
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
          100 nodes · 30 samples · native layout event
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
