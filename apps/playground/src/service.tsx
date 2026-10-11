import { AnswerSession } from "@engine/core";
import { neutral } from "@engine/kit-neutral";
import { AnswerView, createUIRuntime, UIProvider, UISurface } from "@engine/renderer-react";
import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { sampleContent } from "../../../fixtures/media/host";
import cases from "../../../fixtures/service/cases.json";
import "@engine/renderer-react/styles.css";
import "./service.css";
function Service() {
  const [id, setId] = useState(cases[0].id),
    [dark, setDark] = useState(true),
    [status, setStatus] = useState("");
  const state = useMemo(() => {
    const runtime = createUIRuntime({
      onAction: (action) =>
        setStatus(`${action.name}: ${JSON.stringify(action.context)} · 데모 요청만 기록했습니다.`),
    });
    const content = sampleContent(runtime.attachments, location.origin, (id) =>
      setStatus(`원본 열기: ${id}`),
    );
    const session = new AnswerSession(runtime);
    session.push(cases.find((f) => f.id === id)!.wire);
    session.end();
    return { runtime, content, session };
  }, [id]);
  React.useEffect(() => () => state.runtime.dispose(), [state]);
  const kit = useMemo(
    () => ({
      ...neutral,
      id: "service",
      tokens: {
        ...neutral.tokens,
        radius: 18,
        typography: { ...neutral.tokens.typography, body: "inherit", heading: "inherit" },
        dark: {
          background: "#080808",
          surface: "#080808",
          foreground: "#f5f5f5",
          muted: "#b3b3b3",
          accent: "#3186f5",
          onAccent: "#ffffff",
          border: "#282828",
          danger: "#f87171",
          success: "#32d583",
        },
      },
    }),
    [],
  );
  return (
    <main className={`service-demo ${dark ? "dark" : ""}`}>
      <header>
        <a href="/showcase.html">MeldUI</a>
        <span>서비스 임베딩 · 합성 데모</span>
        <button onClick={() => setDark(!dark)} type="button">
          {dark ? "라이트" : "다크"}
        </button>
      </header>
      <nav aria-label="예제">
        {cases.map((f) => (
          <button
            type="button"
            key={f.id}
            aria-current={id === f.id ? "page" : undefined}
            onClick={() => setId(f.id)}
          >
            {f.title}
          </button>
        ))}
      </nav>
      <article>
        <UIProvider
          runtime={state.runtime}
          kit={kit}
          mode={dark ? "dark" : "light"}
          content={state.content}
        >
          <AnswerView
            session={state.session}
            renderSurface={(block) => (
              <section data-block={block.id}>
                <UISurface surfaceId={block.surfaceId} />
              </section>
            )}
          />
        </UIProvider>
        <p role="status">{status}</p>
      </article>
      <footer>
        SDK는 호스트의 데이터·컴포넌트·테마를 사용합니다. 알림·저장·권한 변경은 호스트가 검증하고
        실행합니다.
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Service />);
