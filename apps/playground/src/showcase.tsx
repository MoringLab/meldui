import { AnswerSession } from "@engine/core";
import { brand } from "@engine/kit-brand";
import { editorial } from "@engine/kit-editorial";
import { neutral } from "@engine/kit-neutral";
import {
  AnswerView,
  type AppRuntimeProvider,
  createUIRuntime,
  type SandboxViewerRuntime,
  UIProvider,
} from "@engine/renderer-react";
import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { sampleContent } from "../../../fixtures/media/host";
import cases from "../../../fixtures/showcase/cases.json";
import { loadAppResources } from "./app-resources";
import { brandComponents } from "./brand";
import "@engine/renderer-react/styles.css";
import "./showcase.css";
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
    [isolation, setIsolation] = useState(false),
    [providerKind, setProviderKind] = useState("live");
  const [settingsOpen, setSettingsOpen] = useState(() => window.innerWidth >= 720);
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
  const live = useMemo<AppRuntimeProvider>(
    () => ({
      kind: "live",
      assurance: "browser",
      loadResources: loadAppResources,
      onSnapshot: (id, snapshot) => state.session.saveArtifactState(id, snapshot),
    }),
    [state.session],
  );
  return (
    <main className="showcase">
      <header className="showcase-header">
        <h1>MeldUI Showcase</h1>
        <a href="/">Open lab</a>
      </header>
      {hostAction && <p role="status">{hostAction}</p>}
      <p className="showcase-intro">아이디어를 직접 조작하며 탐색하세요.</p>
      <div className="showcase-settings">
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
        <details
          className="showcase-display"
          open={settingsOpen}
          onToggle={(e) => setSettingsOpen(e.currentTarget.open)}
        >
          <summary>표시 설정</summary>
          <div className="showcase-display-body">
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
              웹 위젯 실행 허용
            </label>
            <label>
              실행기
              <select value={providerKind} onChange={(e) => setProviderKind(e.target.value)}>
                <option value="live">Live · browser</option>
                <option value="strict">Strict · Docker</option>
              </select>
            </label>
            <a href="/studio.html">Kit studio</a>
            <a href="/service.html">서비스 임베딩</a>
          </div>
        </details>
      </div>
      <div className="showcase-canvas">
        <UIProvider
          runtime={state.runtime}
          kit={{ neutral, editorial, brand }[kit as "neutral"]}
          mode={dark ? "dark" : "light"}
          content={state.content}
          components={brandComponents}
        >
          {new URLSearchParams(location.search).has("strict") ? (
            <React.StrictMode>
              <AnswerView
                session={state.session}
                sandbox={isolation && providerKind === "strict" ? sandbox : undefined}
                appRuntime={isolation && providerKind === "live" ? live : undefined}
              />
            </React.StrictMode>
          ) : (
            <AnswerView
              session={state.session}
              sandbox={isolation && providerKind === "strict" ? sandbox : undefined}
              appRuntime={isolation && providerKind === "live" ? live : undefined}
            />
          )}
        </UIProvider>
      </div>
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
