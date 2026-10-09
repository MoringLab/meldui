import { NDJSONDecoder, readBytes, type UIModelEvent, type UIRuntime } from "@engine/core";
import { editorial } from "@engine/kit-editorial";
import { neutral } from "@engine/kit-neutral";
import type { UIMessage, UserAction } from "@engine/protocol";
import { createUIRuntime, Icon, UIProvider, UISurface } from "@engine/renderer-react";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import fixtures from "../../../fixtures/cases.json";
import "@engine/renderer-react/styles.css";
import "./styles.css";

const groups: Record<string, string> = {
  calculator: "계산하기",
  comparison: "비교하기",
  form: "입력받기",
  planner: "계획하기",
  dashboard: "살펴보기",
  explanation: "이해하기",
  game: "놀아보기",
};
function App() {
  const [kitId, setKitId] = useState("neutral");
  const [mode, setMode] = useState<"light" | "dark">("light");
  const [active, setActive] = useState(
    new URLSearchParams(location.search).get("fixture") ?? "calculator",
  );
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("예제를 선택하거나 새로운 인터페이스를 요청하세요.");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState([
    "cx/gpt-5.6-sol-medium",
    "agy/claude-sonnet-4-6",
    "agy/gemini-3.7-flash-medium",
  ]);
  const [model, setModel] = useState(models[0]);
  const [runtime, setRuntime] = useState<UIRuntime>(() => createUIRuntime());
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const sessionId = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const run = useRef(0);
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const onAction = useRef<(action: UserAction) => void>(() => {});
  const fresh = () => {
    const value = createUIRuntime({
      onDiagnostic: (d) =>
        setDiagnostics((items) => [
          ...items.slice(-49),
          `${d.code}${d.componentId ? ` · ${d.componentId}` : ""}`,
        ]),
      onAction: (action) => onAction.current(action),
      clientActions: {
        copyText: async (args) => {
          await navigator.clipboard.writeText(String(args.text ?? ""));
          setStatus("클립보드에 복사했습니다.");
        },
        openUrl: async (args) => {
          if (window.confirm(`${String(args.url)} 주소를 여시겠습니까?`))
            window.open(String(args.url), "_blank", "noopener,noreferrer");
        },
      },
    });
    runtimeRef.current.dispose();
    runtimeRef.current = value;
    setRuntime(value);
    setMessages([]);
    setDiagnostics([]);
    sessionId.current = undefined;
    return value;
  };
  async function replay(id: string) {
    abortRef.current?.abort();
    const generation = ++run.current;
    setBusy(false);
    setActive(id);
    const value = fresh();
    const fixture = fixtures.find((f) => f.id === id) ?? fixtures[0];
    setStatus("예제를 차례로 표시하고 있습니다.");
    for (const message of fixture.messages) {
      if (generation !== run.current) return;
      value.accept(message);
      setMessages((items) => [...items, message as UIMessage]);
      await new Promise((resolve) => setTimeout(resolve, 28));
    }
    value.finish();
    setStatus("준비되었습니다. 입력값을 바꿔보세요.");
  }
  async function generate(text: string, action?: UserAction) {
    if (!text.trim()) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    ++run.current;
    const value = action ? runtimeRef.current : fresh();
    value.beginRun("main");
    setBusy(true);
    setActive("");
    setStatus("모델이 인터페이스를 만들고 있습니다.");
    setPrompt("");
    try {
      const response = await fetch("/api/ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          action,
          model,
          kitId,
          platform: "web",
          sessionId: sessionId.current,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(
          body.error === "GATEWAY_NOT_CONFIGURED"
            ? "서버에 OmniRoute 키를 설정한 뒤 다시 시도하세요."
            : `요청을 완료하지 못했습니다 (${response.status}).`,
        );
      }
      const decoder = new NDJSONDecoder();
      const accept = (raw: unknown) => {
        const event = raw as
          | UIModelEvent
          | { type: "session"; sessionId: string }
          | { type: "repair"; attempt: number };
        if (event.type === "session") sessionId.current = event.sessionId;
        else if (event.type === "message") {
          value.accept(event.message);
          setMessages((items) => [...items, event.message]);
        } else if (event.type === "diagnostic")
          setDiagnostics((items) => [...items.slice(-49), event.diagnostic.code]);
        else if (event.type === "repair")
          setStatus(`일부 항목을 수정하고 있습니다 (${event.attempt}/2).`);
        else if (event.type === "complete")
          setStatus(
            event.status === "completed"
              ? "완료되었습니다. 화면에서 바로 사용해보세요."
              : "일부 항목을 완료하지 못했습니다. 다시 요청할 수 있습니다.",
          );
      };
      if (!response.body) throw new Error("스트림을 사용할 수 없습니다.");
      for await (const bytes of readBytes(response.body, controller.signal)) {
        if (controller.signal.aborted) break;
        for (const event of decoder.push(bytes)) accept(event);
      }
      if (!controller.signal.aborted) for (const event of decoder.finish()) accept(event);
    } catch (error) {
      setStatus(
        controller.signal.aborted
          ? "생성을 중단했습니다."
          : error instanceof Error
            ? error.message
            : "연결을 확인하고 다시 시도하세요.",
      );
    } finally {
      if (abortRef.current === controller) setBusy(false);
    }
  }
  onAction.current = (action) => {
    void generate(
      `사용자가 ${action.name} 작업을 요청했습니다. 현재 화면에 결과를 반영하세요.`,
      action,
    );
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: Bootstrap the first fixture once; later choices are explicit interactions.
  useEffect(() => {
    void replay(active);
    void fetch("/api/models")
      .then((r) => r.json())
      .then((body) => {
        setModels(body.models);
        setModel(body.defaultModel);
      })
      .catch(() => {});
    return () => {
      run.current++;
      abortRef.current?.abort();
      runtimeRef.current.dispose();
    };
  }, []);
  const kit = kitId === "editorial" ? editorial : neutral;
  return (
    <div className={`lab ${mode}`} style={{ colorScheme: mode }}>
      <header className="lab-header">
        <a className="wordmark" href="/" aria-label="Engine 처음으로">
          <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
            <path d="M4 5h20v5H9v4h12v4H9v5H4Z" fill="currentColor" />
          </svg>
          Engine<span>인터페이스 랩</span>
        </a>
        <div className="header-controls">
          <label>
            스타일
            <select aria-label="디자인 킷" value={kitId} onChange={(e) => setKitId(e.target.value)}>
              <option value="neutral">Neutral</option>
              <option value="editorial">Editorial</option>
            </select>
          </label>
          <button
            type="button"
            className="plain-button"
            onClick={() => setMode(mode === "light" ? "dark" : "light")}
          >
            {mode === "light" ? "다크 모드" : "라이트 모드"}
          </button>
        </div>
      </header>
      <div className="lab-body">
        <aside className="example-rail">
          <div className="rail-heading">
            <h2>만들어볼 것들</h2>
            <span>{fixtures.length}개 예제</span>
          </div>
          <p>작은 도구부터 시작해보세요.</p>
          <nav aria-label="예제">
            {Object.entries(groups).map(([category, label]) => (
              <section key={category}>
                <h3>{label}</h3>
                {fixtures
                  .filter((f) => f.category === category)
                  .map((f) => (
                    <button
                      type="button"
                      key={f.id}
                      className={active === f.id ? "active" : ""}
                      onClick={() => void replay(f.id)}
                    >
                      {f.title}
                      <Icon name="arrow" />
                    </button>
                  ))}
              </section>
            ))}
          </nav>
          <footer>
            하나의 구조, 여러 가지 표현.
            <br />
            웹과 앱에서 같은 방식으로.
          </footer>
        </aside>
        <main className="workspace">
          <div className="canvas-top">
            <span className="status-dot" />
            {active ? "리플레이 예제" : "생성된 인터페이스"}
            <span className="canvas-meta">
              {kit.name} · {messages.length} messages
            </span>
          </div>
          <div className="result-canvas">
            <UIProvider runtime={runtime} kit={kit} mode={mode}>
              <UISurface />
            </UIProvider>
            {!runtime.surfaceIds.length && (
              <div className="empty">
                <h1>어떤 도구가 필요한가요?</h1>
                <p>설명하고, 비교하고, 직접 조절할 수 있는 화면을 만들어보세요.</p>
              </div>
            )}
          </div>
          <div className="composer-wrap">
            <p role="status" className="generation-status">
              {status}
            </p>
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                void generate(prompt);
              }}
            >
              <label className="sr-only" htmlFor="prompt">
                만들고 싶은 인터페이스
              </label>
              <textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="예: 인원과 팁을 조절할 수 있는 식사비 계산기"
                rows={2}
              />
              <div className="composer-bottom">
                <label className="model-picker">
                  <span className="sr-only">모델</span>
                  <select
                    aria-label="모델"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    {models.map((id) => (
                      <option key={id}>{id}</option>
                    ))}
                  </select>
                </label>
                {busy ? (
                  <button
                    type="button"
                    className="send-button"
                    onClick={() => abortRef.current?.abort()}
                  >
                    중단
                  </button>
                ) : (
                  <button type="submit" className="send-button" disabled={!prompt.trim()}>
                    만들기
                    <Icon name="arrow" />
                  </button>
                )}
              </div>
            </form>
            <details className="inspector">
              <summary>
                메시지와 진단 보기{" "}
                <span>
                  {diagnostics.length
                    ? `${diagnostics.length}개 진단`
                    : `${messages.length}개 메시지`}
                </span>
              </summary>
              {diagnostics.length > 0 && (
                <ul>
                  {[...new Set(diagnostics)].map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
              <pre>{messages.map((m) => JSON.stringify(m)).join("\n")}</pre>
              <button
                type="button"
                className="plain-button"
                onClick={() => {
                  const blob = new Blob([messages.map((m) => JSON.stringify(m)).join("\n")], {
                    type: "application/x-ndjson",
                  });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = "engine-replay.ndjson";
                  link.click();
                  URL.revokeObjectURL(url);
                }}
              >
                리플레이 저장
              </button>
            </details>
          </div>
        </main>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
