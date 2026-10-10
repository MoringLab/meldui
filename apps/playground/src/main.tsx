import {
  AnswerSession,
  NDJSONDecoder,
  readBytes,
  type UIModelEvent,
  type UIRuntime,
} from "@engine/core";
import { brand } from "@engine/kit-brand";
import { editorial } from "@engine/kit-editorial";
import { neutral } from "@engine/kit-neutral";
import type { HostPolicy, UserAction } from "@engine/protocol";
import { AnswerView, createUIRuntime, Icon, UIProvider } from "@engine/renderer-react";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import fixtures from "../../../fixtures/cases.json";
import hybridFixtures from "../../../fixtures/hybrid/cases.json";
import "@engine/renderer-react/styles.css";
import { brandComponents } from "./brand";
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
  const [policyMode, setPolicyMode] = useState<HostPolicy["mode"]>("auto");
  const [session, setSession] = useState<AnswerSession>(() => new AnswerSession(createUIRuntime()));
  const runtime: UIRuntime = session.runtime;
  const [messages, setMessages] = useState<string[]>([]);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const sessionId = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const run = useRef(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const policyRef = useRef<Partial<HostPolicy>>({});
  policyRef.current = { mode: policyMode };
  const onAction = useRef<(action: UserAction) => void>(() => {});
  const activate = (value: AnswerSession) => {
    sessionRef.current.runtime.dispose();
    sessionRef.current = value;
    setSession(value);
  };
  const fresh = (display = true) => {
    const runtime = createUIRuntime({
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
    const value = new AnswerSession(runtime, { policy: policyRef.current });
    if (display) activate(value);
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
    const hybridFixture = hybridFixtures.find((f) => f.id === id);
    const fixture = fixtures.find((f) => f.id === id) ?? fixtures[0];
    // Legacy fixtures replay as one JSON control line per message; hybrid ones as the mixed text.
    const lines = hybridFixture
      ? hybridFixture.wire.split("\n")
      : [
          JSON.stringify({
            engine: "v1",
            block: "surface",
            surfaceId: "main",
            fallbackText: `${fixture.title}. ${fixture.prompt}`,
          }),
          ...fixture.messages.map((m) => JSON.stringify(m)),
        ];
    setStatus("예제를 차례로 표시하고 있습니다.");
    for (const line of lines) {
      if (generation !== run.current) return;
      value.push(`${line}\n`);
      setMessages((items) => [...items, `${line}\n`]);
      await new Promise((resolve) => setTimeout(resolve, 28));
    }
    if (generation !== run.current) return;
    value.end();
    setStatus("준비되었습니다. 입력값을 바꿔보세요.");
  }
  async function generate(text: string, action?: UserAction) {
    if (!text.trim()) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    ++run.current;
    const value = action ? sessionRef.current : fresh(false);
    if (action) value.beginTurn();
    let displayed = !!action;
    value.runtime.beginRun("main");
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
          format: "hybrid",
          policy: policyRef.current,
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
        else if (event.type === "text") {
          value.push(event.text);
          setMessages((items) => [...items.slice(-399), event.text]);
          if (!displayed && value.blocks.length) {
            activate(value);
            displayed = true;
          }
        } else if (event.type === "diagnostic")
          setDiagnostics((items) => [...items.slice(-49), event.diagnostic.code]);
        else if (event.type === "repair") {
          value.beginTurn();
          setStatus(`일부 항목을 수정하고 있습니다 (${event.attempt}/2).`);
        } else if (event.type === "complete") {
          value.end();
          setStatus(
            event.status === "completed"
              ? "완료되었습니다. 화면에서 바로 사용해보세요."
              : "일부 항목을 완료하지 못했습니다. 다시 요청할 수 있습니다.",
          );
        }
      };
      if (!response.body) throw new Error("스트림을 사용할 수 없습니다.");
      for await (const bytes of readBytes(response.body, controller.signal)) {
        if (controller.signal.aborted) break;
        for (const event of decoder.push(bytes)) accept(event);
      }
      if (!controller.signal.aborted) for (const event of decoder.finish()) accept(event);
    } catch (error) {
      if (abortRef.current !== controller) return;
      setStatus(
        controller.signal.aborted
          ? "생성을 중단했습니다."
          : error instanceof Error
            ? error.message
            : "연결을 확인하고 다시 시도하세요.",
      );
    } finally {
      if (!displayed) value.runtime.dispose();
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
      sessionRef.current.runtime.dispose();
    };
  }, []);
  const kit = kitId === "editorial" ? editorial : kitId === "brand" ? brand : neutral;
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
              <option value="brand">Brand</option>
            </select>
          </label>
          <label>
            답변 방식
            <select
              aria-label="답변 방식"
              value={policyMode}
              onChange={(e) => setPolicyMode(e.target.value as HostPolicy["mode"])}
            >
              <option value="auto">자동</option>
              <option value="markdown-only">글만</option>
              <option value="engine-only">화면만</option>
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
            <span>{fixtures.length + hybridFixtures.length}개 예제</span>
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
          <section>
            <h3>섞어 보기</h3>
            {hybridFixtures.map((f) => (
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
              {kit.name} · {messages.length} lines
            </span>
          </div>
          <div className="result-canvas">
            <UIProvider runtime={runtime} kit={kit} mode={mode} components={brandComponents}>
              <AnswerView
                session={session}
                labels={{
                  surface: "인터랙티브 콘텐츠",
                  reset: "초기화",
                  expand: "크게 보기",
                  close: "닫기",
                  viewAsText: "텍스트로 보기",
                  viewAsInterface: "화면으로 보기",
                  incomplete: "일부 내용을 표시하지 못했습니다.",
                }}
              />
            </UIProvider>
            {!session.blocks.length && (
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
              <pre>{messages.join("")}</pre>
              <button
                type="button"
                className="plain-button"
                onClick={() => {
                  const blob = new Blob([messages.join("")], {
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
