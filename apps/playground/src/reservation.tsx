import { neutral } from "@engine/kit-neutral";
import { CATALOG_ID, type Component } from "@engine/protocol";
import { createUIRuntime, UIProvider, UISurface } from "@engine/renderer-react";
import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "@engine/renderer-react/styles.css";
function ReservationApp() {
  const [csrf, setCsrf] = useState(""),
    [status, setStatus] = useState(""),
    [saved, setSaved] = useState<any[]>([]);
  const [password, setPassword] = useState("local-preview");
  const confirm = React.useRef<{ token: string; key: string } | undefined>(undefined);
  const api = async (path: string, options: RequestInit = {}) => {
    const response = await fetch(`/reservations-api${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", "x-csrf-token": csrf, ...options.headers },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  };
  const handlers = React.useRef<(name: string) => Promise<void>>(async () => {});
  const runtime = useMemo(
    () => createUIRuntime({ onAction: (action) => handlers.current(action.name) }),
    [],
  );
  const render = (components: Component[]) =>
    runtime.accept({ version: "v0.9", updateComponents: { surfaceId: "reservation", components } });
  const edit = () =>
    render([
      { id: "root", component: "Column", children: ["name", "date", "people", "prepare"] },
      { id: "name", component: "TextField", label: "예약자 이름", value: { path: "/name" } },
      { id: "date", component: "DatePicker", label: "예약 날짜", value: { path: "/date" } },
      {
        id: "people",
        component: "Slider",
        label: "인원",
        min: 1,
        max: 12,
        step: 1,
        value: { path: "/people" },
      },
      {
        id: "prepare",
        component: "Button",
        label: "예약 내용 확인",
        action: { event: { name: "prepare" } },
      },
    ]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: initialize one isolated runtime; edit only references that runtime
  useEffect(() => {
    runtime.accept({
      version: "v0.9",
      createSurface: { surfaceId: "reservation", catalogId: CATALOG_ID },
    });
    runtime.accept({
      version: "v0.9",
      updateDataModel: {
        surfaceId: "reservation",
        value: { name: "민지", date: "2026-12-01", people: 2 },
      },
    });
    edit();
    return () => runtime.dispose();
  }, [runtime]);
  handlers.current = async (name) => {
    try {
      if (name === "prepare") {
        const draft = runtime.read("reservation", "/") as any;
        const result = await api("/prepare", {
          method: "POST",
          body: JSON.stringify({ name: draft.name, date: draft.date, people: draft.people }),
        });
        confirm.current = { token: result.token, key: crypto.randomUUID() };
        render([
          { id: "root", component: "Column", children: ["confirm", "edit"] },
          {
            id: "confirm",
            component: "Confirmation",
            title: "서버에서 확인한 예약 내용",
            detail: `${result.draft.date}, ${result.draft.people}명, ${result.draft.name}`,
            label: "확인하고 예약 저장",
            action: { event: { name: "confirm" } },
          },
          {
            id: "edit",
            component: "Button",
            label: "돌아가서 수정",
            action: { event: { name: "edit" } },
          },
        ]);
      }
      if (name === "edit") {
        confirm.current = undefined;
        edit();
      }
      if (name === "confirm") {
        if (!confirm.current) throw new Error("CONFIRMATION_REQUIRED");
        const value = await api("/confirm", {
          method: "POST",
          headers: { "idempotency-key": confirm.current.key },
          body: JSON.stringify({ token: confirm.current.token }),
        });
        setStatus(`예약 저장 완료: ${value.id}`);
        setSaved((await api("/reservations")).reservations);
      }
    } catch (error) {
      setStatus(
        `요청 실패: ${(error as Error).message}. 입력은 유지됩니다. 다시 시도할 수 있습니다.`,
      );
    }
  };
  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 24 }}>
      <h1>예약 서비스</h1>
      <p>로컬 SQLite 데모입니다. 인증·확인·저장은 호스트 서비스가 처리합니다.</p>
      {!csrf ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void api("/session", {
              method: "POST",
              body: JSON.stringify({ user: "alice", password }),
            })
              .then((r) => setCsrf(r.csrf))
              .catch((error) => setStatus(error.message));
          }}
        >
          <label>
            데모 비밀번호
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button type="submit">호스트 세션 시작</button>
        </form>
      ) : (
        <UIProvider runtime={runtime} kit={neutral}>
          <UISurface surfaceId="reservation" />
        </UIProvider>
      )}
      <p role="status">{status}</p>
      <ul>
        {saved.map((row) => (
          <li key={row.id}>
            {row.draft.date} {row.draft.people}명 — {row.status}
            <button
              type="button"
              disabled={row.status === "cancelled"}
              onClick={() =>
                void api(`/reservations/${row.id}`, { method: "DELETE" })
                  .then(() => api("/reservations"))
                  .then((r) => setSaved(r.reservations))
              }
            >
              예약 취소
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<ReservationApp />);
