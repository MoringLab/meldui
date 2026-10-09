import { A2uiSurface, createBinderlessComponentImplementation } from "@a2ui/react/v0_9";
import {
  createUIRuntime as createCoreRuntime,
  type NodeSnapshot,
  type RuntimeOptions,
  resolvePath,
  type UIRuntime,
} from "@engine/core";
import { type UIKit, validateKit } from "@engine/kit-spec";
import { type ChildList, componentSchemas } from "@engine/protocol";
import React, {
  type CSSProperties,
  createContext,
  memo,
  Component as ReactComponent,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useSyncExternalStore,
} from "react";

export type ComponentViewProps = {
  node: NodeSnapshot;
  children: ReactNode;
  runtime: UIRuntime;
  surfaceId: string;
  renderChild: (id: string, scope?: string) => ReactNode;
};
export type ComponentViews = Record<string, React.ComponentType<ComponentViewProps>>;
type ContextValue = {
  runtime: UIRuntime;
  kit: UIKit;
  mode: "light" | "dark";
  assets: Record<string, string>;
  views: ComponentViews;
};
const Context = createContext<ContextValue | null>(null);
function useUI() {
  const value = useContext(Context);
  if (!value) throw new Error("UIProvider is required");
  return value;
}

/** Create a core runtime with the upstream React implementations attached. */
export function createUIRuntime(options: RuntimeOptions = {}) {
  const components = Object.entries(componentSchemas).map(([name, schema]) =>
    createBinderlessComponentImplementation({ name, schema }, ({ context }) => (
      <EngineNode
        surfaceId={context.dataContext.surface.id}
        id={context.componentModel.id}
        scope={context.dataContext.path}
      />
    )),
  );
  return createCoreRuntime({ ...options, components: options.components ?? components });
}

/** Apply a trusted kit without recreating the state model. */
export function UIProvider({
  runtime,
  kit,
  mode = "light",
  assets = {},
  components = {},
  children,
}: {
  runtime: UIRuntime;
  kit: UIKit;
  mode?: "light" | "dark";
  assets?: Record<string, string>;
  components?: ComponentViews;
  children: ReactNode;
}) {
  validateKit(kit);
  const colors = kit.tokens[mode];
  const style: CSSProperties = {
    colorScheme: mode,
    fontFamily: kit.tokens.typography.body,
    fontSize: kit.tokens.typography.baseSize,
    ...Object.fromEntries(Object.entries(colors).map(([k, v]) => [`--ui-${k}`, v])),
    "--ui-heading": kit.tokens.typography.heading,
    "--ui-radius": `${kit.tokens.radius}px`,
  } as CSSProperties;
  return (
    <Context.Provider value={{ runtime, kit, mode, assets, views: components }}>
      <div className={`engine-ui kit-${kit.id}`} style={style}>
        {children}
      </div>
    </Context.Provider>
  );
}

/** Render one surface, or all active surfaces if no id is supplied. */
export function UISurface({ surfaceId }: { surfaceId?: string }) {
  const { runtime } = useUI();
  useSyncExternalStore(runtime.subscribe, runtime.getRevision, runtime.getRevision);
  const ids = surfaceId ? [surfaceId] : runtime.surfaceIds;
  return (
    <>
      {ids.map((id) => {
        const surface = runtime.getSurface(id);
        return surface ? (
          <SurfaceBoundary key={id}>
            <section className="ui-surface" aria-label="생성된 인터페이스" data-surface={id}>
              <A2uiSurface surface={surface} />
            </section>
          </SurfaceBoundary>
        ) : (
          <Loading key={id} />
        );
      })}
    </>
  );
}
class SurfaceBoundary extends ReactComponent<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div role="alert" className="ui-error">
        이 영역을 표시할 수 없습니다.
      </div>
    ) : (
      this.props.children
    );
  }
}
function Loading() {
  return <div className="ui-skeleton" role="status" aria-label="콘텐츠 불러오는 중" />;
}

const EngineNode = memo(function EngineNode({
  surfaceId,
  id,
  scope = "/",
}: {
  surfaceId: string;
  id: string;
  scope?: string;
}) {
  const { runtime, views } = useUI();
  const subscribe = useCallback(
    (listener: () => void) => runtime.subscribeNode(surfaceId, id, scope, listener),
    [runtime, surfaceId, id, scope],
  );
  const getSnapshot = useCallback(
    () => runtime.getNodeSnapshot(surfaceId, id, scope),
    [runtime, surfaceId, id, scope],
  );
  const node = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (node.error)
    return (
      <div className="ui-error" role="alert" data-node={id}>
        이 항목을 표시할 수 없습니다. <small>{node.error}</small>
      </div>
    );
  if (!node.component) return <Loading />;
  if (node.props.visible === false) return null;
  const renderChild = (childId: string, childScope = scope) => (
    <EngineNode
      key={`${childId}:${childScope}`}
      surfaceId={surfaceId}
      id={childId}
      scope={childScope}
    />
  );
  const children = renderChildren(node.props.children, runtime, surfaceId, scope, renderChild);
  const View = views[node.component] ?? DefaultView;
  return (
    <SurfaceBoundary key={`${id}:${node.component}`}>
      <View node={node} runtime={runtime} surfaceId={surfaceId} renderChild={renderChild}>
        {children}
      </View>
    </SurfaceBoundary>
  );
});

function renderChildren(
  children: ChildList | undefined,
  runtime: UIRuntime,
  surfaceId: string,
  scope: string,
  render: (id: string, scope?: string) => ReactNode,
): ReactNode {
  if (!children) return null;
  if (Array.isArray(children)) return children.map((id) => render(id));
  const values = runtime.read(surfaceId, children.path, scope);
  return Array.isArray(values)
    ? values
        .slice(0, 1000)
        .map((_, index) =>
          render(children.componentId, `${resolvePath(children.path, scope)}/${index}`),
        )
    : null;
}

function DefaultView({ node, children, runtime, surfaceId, renderChild }: ComponentViewProps) {
  const { kit, assets } = useUI();
  const inputId = useId();
  const p = node.props;
  const text = (v: unknown) => String(v ?? "");
  const value = p.value ?? "";
  const bound = node.raw?.value as { path?: string } | undefined;
  const write = (v: unknown) => {
    if (bound?.path) runtime.setValue(surfaceId, bound.path, v, node.scope);
  };
  const fire = () => {
    void runtime.dispatch(surfaceId, node.id, p.action, node.scope);
  };
  const label = text(p.label);
  const disabled = Boolean(p.disabled) || !bound?.path;
  const gap = kit.tokens.spacing[(p.gap ?? "md") as keyof UIKit["tokens"]["spacing"]];
  const field = (control: ReactNode) => (
    <div className="ui-field" data-node={node.id}>
      <label htmlFor={inputId}>{label}</label>
      {control}
      {p.error && (
        <small className="ui-error" id={`${inputId}-error`}>
          {text(p.error)}
        </small>
      )}
    </div>
  );
  const inputProps = {
    id: inputId,
    disabled,
    "aria-invalid": Boolean(p.error),
    "aria-describedby": p.error ? `${inputId}-error` : undefined,
  };
  switch (node.component) {
    case "Form":
      return (
        <form
          className="ui-column"
          aria-label={label}
          onSubmit={(event) => {
            event.preventDefault();
            void runtime.dispatch(surfaceId, node.id, p.onSubmit, node.scope);
          }}
        >
          {children}
          <button type="submit" className="ui-button secondary">
            제출
          </button>
        </form>
      );
    case "Row":
    case "Column":
      return (
        <div
          className={node.component === "Row" ? "ui-row" : "ui-column"}
          data-node={node.id}
          style={{
            gap,
            alignItems:
              p.align === "start" ? "flex-start" : p.align === "end" ? "flex-end" : p.align,
          }}
        >
          {children}
        </div>
      );
    case "Grid":
      return (
        <div
          className="ui-grid"
          data-node={node.id}
          style={{ gap, "--ui-columns": p.columns } as CSSProperties}
        >
          {children}
        </div>
      );
    case "Card":
      return kit.id === "editorial" ? (
        <article className="ui-card editorial-card">
          {p.title && (
            <header>
              <h2 className="ui-card-title">{text(p.title)}</h2>
            </header>
          )}
          <div className="ui-column">{children}</div>
        </article>
      ) : (
        <section className="ui-card">
          {p.title && <h2 className="ui-card-title">{text(p.title)}</h2>}
          <div className="ui-column">{children}</div>
        </section>
      );
    case "Divider":
      return <hr className="ui-divider" />;
    case "Heading":
      return React.createElement(
        `h${p.level ?? 2}`,
        {
          className: `ui-heading${kit.id === "editorial" ? " editorial-heading" : ""}`,
          "data-node": node.id,
        },
        text(p.text),
      );
    case "Text":
      return (
        <p className={`ui-text tone-${p.tone ?? "default"}`} data-node={node.id}>
          {text(p.text)}
        </p>
      );
    case "Image":
      return assets[p.asset] ? (
        <img
          className="ui-image"
          src={assets[p.asset]}
          alt={p.alt}
          style={{ aspectRatio: p.aspectRatio }}
        />
      ) : (
        <div className="ui-asset-placeholder" role="img" aria-label={p.alt}>
          {p.alt}
        </div>
      );
    case "Icon":
      return <Icon name={p.name} label={p.label} />;
    case "Badge":
      return <span className={`ui-badge tone-${p.tone ?? "default"}`}>{text(p.text)}</span>;
    case "Callout":
      return (
        <aside className={`ui-callout tone-${p.tone}`}>
          <strong>{text(p.title)}</strong>
          <p>{text(p.text)}</p>
        </aside>
      );
    case "CodeBlock":
      return (
        <pre className="ui-code">
          <code>{text(p.code)}</code>
        </pre>
      );
    case "List": {
      const Tag = p.ordered ? "ol" : "ul";
      return (
        <Tag className="ui-list">
          {React.Children.map(children, (child) => (
            <li>{child}</li>
          ))}
        </Tag>
      );
    }
    case "Table":
      return <DataTable caption={text(p.caption)} columns={p.columns} rows={p.rows} />;
    case "Progress":
      return (
        <div className="ui-field">
          <label htmlFor={inputId}>
            {label}{" "}
            <span>
              {text(p.value)} / {p.max}
            </span>
          </label>
          <progress id={inputId} value={Number(p.value) || 0} max={p.max} />
        </div>
      );
    case "Button":
      return (
        <button
          type="button"
          className={`ui-button ${p.variant} ${kit.id === "editorial" ? "editorial-button" : ""}`}
          disabled={Boolean(p.disabled)}
          onClick={fire}
          data-node={node.id}
        >
          {label}
          {kit.id === "editorial" && <Icon name="arrow" />}
        </button>
      );
    case "TextField":
      return field(
        p.multiline ? (
          <textarea
            {...inputProps}
            value={text(value)}
            placeholder={p.placeholder}
            onChange={(e) => write(e.target.value)}
          />
        ) : (
          <input
            {...inputProps}
            type="text"
            value={text(value)}
            placeholder={p.placeholder}
            onChange={(e) => write(e.target.value)}
          />
        ),
      );
    case "Select":
      return field(
        <select {...inputProps} value={text(value)} onChange={(e) => write(e.target.value)}>
          {p.options.map((option: { value: string; label: string }) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>,
      );
    case "Checkbox":
      return (
        <label className="ui-check">
          <input
            type="checkbox"
            checked={Boolean(value)}
            disabled={disabled}
            onChange={(e) => write(e.target.checked)}
          />
          {label}
        </label>
      );
    case "Slider":
      return field(
        <div className="ui-slider">
          <input
            {...inputProps}
            type="range"
            value={Number(value) || 0}
            min={p.min}
            max={p.max}
            step={p.step}
            onChange={(e) => write(Number(e.target.value))}
          />
          <output htmlFor={inputId}>{text(value)}</output>
        </div>,
      );
    case "DatePicker":
      return field(
        <input
          {...inputProps}
          type="date"
          value={text(value)}
          min={p.min}
          max={p.max}
          onChange={(e) => write(e.target.value)}
        />,
      );
    case "Tabs": {
      const tabs = p.tabs as { id: string; label: unknown; child: string }[];
      const selected = tabs.find((tab) => tab.id === value) ?? tabs[0];
      return (
        <div className="ui-tabs">
          <div
            role="tablist"
            aria-label={p.accessibilityLabel ?? "보기 선택"}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const index = tabs.indexOf(selected);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
              write(tabs[next].id);
              event.currentTarget
                .querySelectorAll<HTMLButtonElement>('[role="tab"]')
                [next]?.focus();
            }}
          >
            {tabs.map((tab) => (
              <button
                type="button"
                role="tab"
                id={`${inputId}-${tab.id}`}
                aria-controls={`${inputId}-panel`}
                aria-selected={tab === selected}
                tabIndex={tab === selected ? 0 : -1}
                key={tab.id}
                onClick={() => write(tab.id)}
              >
                {text(runtime.resolve(surfaceId, tab.label, node.scope))}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`${inputId}-panel`}
            aria-labelledby={`${inputId}-${selected.id}`}
          >
            {renderChild(selected.child)}
          </div>
        </div>
      );
    }
    case "Accordion":
      return (
        <div className="ui-accordion">
          {p.items.map((item: { id: string; label: unknown; child: string }) => (
            <section key={item.id}>
              <h3>
                <button
                  type="button"
                  aria-expanded={value === item.id}
                  aria-controls={`${inputId}-${item.id}`}
                  onClick={() => write(value === item.id ? "" : item.id)}
                >
                  {text(runtime.resolve(surfaceId, item.label, node.scope))}
                  <Icon name="plus" />
                </button>
              </h3>
              <div id={`${inputId}-${item.id}`} hidden={value !== item.id}>
                {renderChild(item.child)}
              </div>
            </section>
          ))}
        </div>
      );
    case "Chart":
      return <Chart node={node} />;
    default:
      return (
        <div className="ui-error" role="alert">
          등록되지 않은 컴포넌트: {node.component}
        </div>
      );
  }
}

/** Small geometric icons bundled with the renderer; model input only selects a name. */
export function Icon({ name, label }: { name: string; label?: string }) {
  const paths: Record<string, string> = {
    check: "m5 12 4 4L19 6",
    info: "M12 10v7m0-10v.1",
    arrow: "M4 12h15m-6-6 6 6-6 6",
    plus: "M12 5v14M5 12h14",
    star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z",
    close: "m6 6 12 12M6 18 18 6",
  };
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {label && <title>{label}</title>}
      <path d={paths[name] ?? paths.info} />
    </svg>
  );
}
function DataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: { key: string; label: string }[];
  rows: unknown;
}) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to focus this labelled horizontally scrollable table region.
    <div className="ui-table-scroll" tabIndex={0} role="region" aria-label={caption}>
      <table className="ui-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(Array.isArray(rows) ? rows : []).map((row: any, i) => (
            <tr key={row.id ?? i}>
              {columns.map((c) => (
                <td key={c.key}>{String(row[c.key] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Chart({ node }: { node: NodeSnapshot }) {
  const p = node.props;
  const titleId = useId();
  const points = (Array.isArray(p.values) ? p.values : []).filter(
    (v: any) => typeof v?.[p.yKey] === "number" && Number.isFinite(v[p.yKey]),
  );
  const min = Math.min(0, ...points.map((v: any) => v[p.yKey]));
  const max = Math.max(1, ...points.map((v: any) => v[p.yKey]));
  const x = (i: number) => 42 + (i * 476) / Math.max(points.length - 1, 1);
  const y = (v: number) => 174 - ((v - min) / (max - min)) * 142;
  return (
    <figure className="ui-chart">
      <figcaption id={titleId}>{String(p.title ?? "")}</figcaption>
      <svg viewBox="0 0 560 220" role="img" aria-labelledby={titleId}>
        <title>{String(p.title ?? "Chart")}</title>
        {[0, 0.5, 1].map((fraction) => {
          const val = min + (max - min) * fraction;
          return (
            <g key={fraction}>
              <line x1="42" x2="536" y1={y(val)} y2={y(val)} stroke="var(--ui-border)" />
              <text x="32" y={y(val) + 4} textAnchor="end">
                {Math.round(val * 10) / 10}
              </text>
            </g>
          );
        })}
        {p.kind === "line" && (
          <polyline
            points={points.map((v: any, i: number) => `${x(i)},${y(v[p.yKey])}`).join(" ")}
            fill="none"
            stroke="var(--ui-accent)"
            strokeWidth="3"
          />
        )}
        {points.map((v: any, i: number) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Immutable SVG marks have no component state; duplicate x coordinates are valid.
          <g key={`${v[p.xKey]}-${i}`}>
            {p.kind === "bar" ? (
              <rect
                x={x(i) - Math.min(22, 200 / points.length)}
                y={Math.min(y(0), y(v[p.yKey]))}
                width={Math.min(44, 400 / points.length)}
                height={Math.max(1, Math.abs(y(v[p.yKey]) - y(0)))}
                fill="var(--ui-accent)"
                rx="2"
              />
            ) : (
              <circle
                cx={x(i)}
                cy={y(v[p.yKey])}
                r={p.kind === "scatter" ? 5 : 3.5}
                fill="var(--ui-accent)"
              />
            )}
            <text x={x(i)} y="202" textAnchor="middle">
              {String(v[p.xKey] ?? i + 1).slice(0, 12)}
            </text>
          </g>
        ))}
      </svg>
      <details>
        <summary>데이터 표 보기</summary>
        <DataTable
          caption={String(p.title ?? "")}
          columns={[
            { key: p.xKey, label: p.xKey },
            { key: p.yKey, label: p.yKey },
          ]}
          rows={points}
        />
      </details>
    </figure>
  );
}
