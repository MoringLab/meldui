import { NDJSONDecoder, readBytes, type UIModelEvent, type UIRuntime } from "@engine/core";
import { editorial } from "@engine/kit-editorial";
import { neutral } from "@engine/kit-neutral";
import type { UserAction } from "@engine/protocol";
import { createUIRuntime, UIProvider, UISurface } from "@engine/renderer-react-native";
import { Picker } from "@react-native-picker/picker";
import { fetch } from "expo/fetch";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import fixtures from "../../fixtures/cases.json";
import { Verification } from "./Verification";

const server = process.env.EXPO_PUBLIC_ENGINE_URL ?? "http://127.0.0.1:8787";
export default function App() {
  return (
    <SafeAreaProvider>
      <Lab />
    </SafeAreaProvider>
  );
}
function Lab() {
  const systemMode = useColorScheme();
  const [mode, setMode] = useState<"light" | "dark">(systemMode === "dark" ? "dark" : "light");
  const [model, setModel] = useState("cx/gpt-5.6-sol-medium");
  const [kitId, setKitId] = useState("neutral");
  const [selected, setSelected] = useState("calculator");
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("예제 준비 중");
  const [busy, setBusy] = useState(false);
  const [inspector, setInspector] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [messageCount, setMessageCount] = useState(0);
  const [runtime, setRuntime] = useState<UIRuntime>(() => createUIRuntime());
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const actionRef = useRef<(action: UserAction) => void>(() => {});
  const abortRef = useRef<AbortController | null>(null);
  const sessionId = useRef<string | undefined>(undefined);
  const runId = useRef(0);
  const surfaceScroll = useRef<ScrollView>(null);
  const kit = kitId === "editorial" ? editorial : neutral;
  const colors = kit.tokens[mode];
  const activate = (next: UIRuntime) => {
    runtimeRef.current.dispose();
    runtimeRef.current = next;
    setRuntime(next);
  };
  const fresh = (display = true) => {
    const next = createUIRuntime({
      onAction: (action) => actionRef.current(action),
      onDiagnostic: (diagnostic) => setDiagnostics((d) => [...d.slice(-39), diagnostic.code]),
      clientActions: {
        openUrl: async ({ url }) => {
          Alert.alert("주소 열기", String(url), [
            { text: "취소", style: "cancel" },
            {
              text: "열기",
              onPress: () => {
                void Linking.openURL(String(url));
              },
            },
          ]);
        },
      },
    });
    if (display) activate(next);
    setDiagnostics([]);
    setMessageCount(0);
    sessionId.current = undefined;
    return next;
  };
  async function replay(id: string) {
    abortRef.current?.abort();
    const run = ++runId.current;
    setBusy(false);
    setSelected(id);
    const next = fresh();
    const fixture = fixtures.find((f) => f.id === id) ?? fixtures[0];
    setStatus("예제를 표시하고 있습니다.");
    for (const message of fixture.messages) {
      if (run !== runId.current) return;
      next.accept(message);
      setMessageCount((n) => n + 1);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (run !== runId.current) return;
    next.finish();
    surfaceScroll.current?.scrollTo({ y: 0, animated: false });
    setStatus("준비되었습니다. 입력값을 바꿔보세요.");
  }
  async function generate(text: string, action?: UserAction) {
    if (!text.trim()) return;
    abortRef.current?.abort();
    ++runId.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const next = action ? runtimeRef.current : fresh(false);
    let displayed = !!action;
    next.beginRun("main");
    setBusy(true);
    setSelected("");
    setPrompt("");
    setStatus("인터페이스를 만들고 있습니다.");
    try {
      const response = await fetch(`${server}/api/ui`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: text,
          action,
          model,
          kitId,
          platform: "react-native",
          sessionId: sessionId.current,
        }),
      });
      if (!response.ok || !response.body)
        throw new Error(`서버 연결을 확인하세요 (${response.status}).`);
      const decoder = new NDJSONDecoder();
      const accept = (input: unknown) => {
        const event = input as
          | UIModelEvent
          | { type: "session"; sessionId: string }
          | { type: "repair"; attempt: number };
        if (event.type === "session") sessionId.current = event.sessionId;
        else if (event.type === "message") {
          next.accept(event.message);
          if (
            !displayed &&
            next.surfaceIds.some((sid) => next.getNodeSnapshot(sid, "root").component)
          ) {
            activate(next);
            displayed = true;
          }
          setMessageCount((n) => n + 1);
        } else if (event.type === "diagnostic")
          setDiagnostics((d) => [...d.slice(-39), event.diagnostic.code]);
        else if (event.type === "repair") setStatus(`일부 항목 수정 중 (${event.attempt}/2)`);
        else if (event.type === "complete")
          setStatus(
            event.status === "completed" ? "완료되었습니다." : "일부 항목을 완료하지 못했습니다.",
          );
      };
      for await (const bytes of readBytes(
        response.body as ReadableStream<Uint8Array>,
        controller.signal,
      )) {
        if (controller.signal.aborted) break;
        for (const event of decoder.push(bytes)) accept(event);
      }
      if (!controller.signal.aborted) for (const event of decoder.finish()) accept(event);
    } catch (error) {
      if (abortRef.current !== controller) return;
      setStatus(controller.signal.aborted ? "생성을 중단했습니다." : String(error));
    } finally {
      if (!displayed) next.dispose();
      if (abortRef.current === controller) setBusy(false);
    }
  }
  actionRef.current = (action) => {
    void generate(`사용자가 ${action.name} 작업을 요청했습니다. 결과를 화면에 반영하세요.`, action);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: Initialize once; replay creates a new runtime and must not rerun on each render.
  useEffect(() => {
    void replay("calculator");
    return () => {
      ++runId.current;
      abortRef.current?.abort();
      runtimeRef.current.dispose();
    };
  }, []);
  const smallButton = (title: string, press: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={press}
      style={{ minHeight: 48, paddingHorizontal: 12, justifyContent: "center" }}
    >
      <Text style={{ color: colors.accent, fontSize: 14 }}>{title}</Text>
    </Pressable>
  );
  if (verifying) return <Verification close={() => setVerifying(false)} />;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style={mode === "dark" ? "light" : "dark"} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 18,
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text
            accessibilityRole="header"
            style={{ color: colors.foreground, fontSize: 23, fontWeight: "600" }}
          >
            Engine
          </Text>
          <View
            style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end" }}
          >
            {smallButton(kitId === "neutral" ? "Editorial로 전환" : "Neutral로 전환", () =>
              setKitId(kitId === "neutral" ? "editorial" : "neutral"),
            )}
            {smallButton(mode === "light" ? "다크 모드" : "라이트 모드", () =>
              setMode(mode === "light" ? "dark" : "light"),
            )}
          </View>
        </View>
        <View style={{ marginHorizontal: 12, borderBottomWidth: 1, borderColor: colors.border }}>
          <Picker
            accessibilityLabel="예제 선택"
            selectedValue={selected}
            onValueChange={(id) => {
              if (id && id !== selected) void replay(id);
            }}
            dropdownIconColor={colors.foreground}
            style={{ color: colors.foreground }}
          >
            {!selected && <Picker.Item label="생성된 인터페이스" value="" />}
            {fixtures.map((fixture) => (
              <Picker.Item key={fixture.id} label={fixture.title} value={fixture.id} />
            ))}
          </Picker>
        </View>
        <ScrollView
          ref={surfaceScroll}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 18, gap: 24 }}
        >
          <UIProvider runtime={runtime} kit={kit} mode={mode}>
            <UISurface />
          </UIProvider>
          <Text accessibilityLiveRegion="polite" style={{ color: colors.muted, fontSize: 13 }}>
            {status}
          </Text>
          <View
            style={{
              backgroundColor: colors.surface,
              padding: 16,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              gap: 12,
            }}
          >
            <TextInput
              accessibilityLabel="만들고 싶은 인터페이스"
              placeholder="어떤 도구가 필요한가요?"
              placeholderTextColor={colors.muted}
              value={prompt}
              onChangeText={setPrompt}
              multiline
              style={{
                minHeight: 64,
                fontSize: 16,
                color: colors.foreground,
                textAlignVertical: "top",
              }}
            />
            <Picker
              accessibilityLabel="AI 모델"
              selectedValue={model}
              onValueChange={setModel}
              dropdownIconColor={colors.foreground}
              style={{ color: colors.foreground }}
            >
              {[
                "cx/gpt-5.6-sol-medium",
                "agy/claude-sonnet-4-6",
                "agy/gemini-3.7-flash-medium",
              ].map((id) => (
                <Picker.Item key={id} label={id} value={id} />
              ))}
            </Picker>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={busy ? "중단" : "만들기"}
              disabled={!busy && !prompt.trim()}
              onPress={() => (busy ? abortRef.current?.abort() : void generate(prompt))}
              style={{
                minHeight: 48,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 6,
                backgroundColor: colors.accent,
                opacity: busy || prompt.trim() ? 1 : 0.5,
              }}
            >
              <Text style={{ color: colors.onAccent, fontSize: 16, fontWeight: "600" }}>
                {busy ? "중단" : "만들기"}
              </Text>
            </Pressable>
          </View>
          {smallButton("메시지와 진단 보기", () => setInspector(!inspector))}
          {inspector && (
            <Text selectable style={{ color: colors.muted, fontSize: 12 }}>
              {messageCount} messages · {kit.name}
              {"\n"}
              {diagnostics.length ? diagnostics.join("\n") : "진단 없음"}
            </Text>
          )}
          {inspector && smallButton("SDK 검증", () => setVerifying(true))}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
