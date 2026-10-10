import { AnswerSession } from "@engine/core";
import { brand } from "@engine/kit-brand";
import { editorial } from "@engine/kit-editorial";
import { neutral } from "@engine/kit-neutral";
import {
  AnswerView,
  createUIRuntime,
  type SandboxViewerRuntime,
  UIProvider,
} from "@engine/renderer-react";
import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { sampleContent } from "../../../fixtures/media/host";
import cases from "../../../fixtures/showcase/cases.json";
import { brandComponents } from "./brand";
import "@engine/renderer-react/styles.css";
const sandbox: SandboxViewerRuntime = {
  verified: true,
  render: async (request, signal) => {
    const response = await fetch("/api/sandbox/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, width: 640, height: 480, allowedActions: [] }),
      signal,
    });
    if (!response.ok) throw new Error("Sandbox unavailable");
    return response.json();
  },
};
function Showcase() {
  const [id, setId] = useState(new URLSearchParams(location.search).get("id") ?? cases[0].id),
    [kit, setKit] = useState("neutral"),
    [dark, setDark] = useState(false),
    [isolation, setIsolation] = useState(false);
  const [hostAction, setHostAction] = useState("");
  const fixture = cases.find((c) => c.id === id) ?? cases[0];
  const state = useMemo(() => {
    const runtime = createUIRuntime({
      onAction: (action) =>
        setHostAction(
          action.name === "verifyRoute"
            ? "호스트에 위치 확인을 요청했습니다. 실제 지도 서비스는 호스트가 연결합니다."
            : action.name,
        ),
    });
    const content = sampleContent(runtime.attachments, location.origin, () => {});
    const session = new AnswerSession(runtime, { policy: { allowSandbox: isolation } });
    session.push(fixture.wire);
    session.end();
    return { runtime, content, session };
  }, [fixture.wire, isolation]);
  React.useEffect(
    () => () => {
      state.runtime.dispose();
    },
    [state],
  );
  return (
    <main style={{ maxWidth: 1080, margin: "32px auto", padding: 24 }}>
      <h1>Engine Showcase</h1>
      {hostAction && <p role="status">{hostAction}</p>}
      <p>선언적 시각화 · 신뢰된 시뮬레이션 · 격리된 실험 · Markdown과 미디어</p>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <label>
          예제
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} {c.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kit
          <select value={kit} onChange={(e) => setKit(e.target.value)}>
            {["neutral", "editorial", "brand"].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />
          다크 모드
        </label>
        <label>
          <input
            type="checkbox"
            checked={isolation}
            onChange={(e) => setIsolation(e.target.checked)}
          />
          검증된 웹 샌드박스 요청
        </label>
        <a href="/reservation.html">예약 서비스</a>
      </div>
      <UIProvider
        runtime={state.runtime}
        kit={{ neutral, editorial, brand }[kit as "neutral"]}
        mode={dark ? "dark" : "light"}
        content={state.content}
        components={brandComponents}
      >
        {new URLSearchParams(location.search).has("strict") ? (
          <React.StrictMode>
            <AnswerView session={state.session} sandbox={isolation ? sandbox : undefined} />
          </React.StrictMode>
        ) : (
          <AnswerView session={state.session} sandbox={isolation ? sandbox : undefined} />
        )}
      </UIProvider>
      <details>
        <summary>생성용 프롬프트와 검증 범위</summary>
        <p>{fixture.promptKo}</p>
        <p>{fixture.promptEn}</p>
        <p>{fixture.acceptance}</p>
        <pre>{state.runtime.diagnostics.map((d) => d.code).join("\n")}</pre>
      </details>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Showcase />);
