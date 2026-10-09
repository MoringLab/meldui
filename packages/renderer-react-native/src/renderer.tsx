import { type NodeSnapshot, resolvePath, type UIRuntime } from "@engine/core";
import { type UIKit, validateKit } from "@engine/kit-spec";
import type { ChildList } from "@engine/protocol";
import DateTimePicker from "@react-native-community/datetimepicker";
import Slider from "@react-native-community/slider";
import { Picker } from "@react-native-picker/picker";
import React, {
  createContext,
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Image,
  type ImageSourcePropType,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import Svg, { Circle, Line, Path, Polyline, Rect, Text as SvgText } from "react-native-svg";

export { createUIRuntime } from "@engine/core";

export type NativeViewProps = {
  node: NodeSnapshot;
  children: ReactNode;
  runtime: UIRuntime;
  surfaceId: string;
  renderChild: (id: string, scope?: string) => ReactNode;
};
type NativeContext = {
  runtime: UIRuntime;
  kit: UIKit;
  mode: "light" | "dark";
  assets: Record<string, ImageSourcePropType>;
  components: Record<string, React.ComponentType<NativeViewProps>>;
};
const Context = createContext<NativeContext | null>(null);
function useUI() {
  const value = useContext(Context);
  if (!value) throw new Error("UIProvider is required");
  return value;
}

/** Apply a portable kit to native widgets while preserving the runtime. */
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
  assets?: NativeContext["assets"];
  components?: NativeContext["components"];
  children: ReactNode;
}) {
  validateKit(kit);
  return (
    <Context.Provider value={{ runtime, kit, mode, assets, components }}>
      <View style={{ backgroundColor: kit.tokens[mode].background }}>{children}</View>
    </Context.Provider>
  );
}
/** Render the same semantic surfaces as the web SDK using native controls. */
export function UISurface({ surfaceId }: { surfaceId?: string }) {
  const { runtime } = useUI();
  useSyncExternalStore(runtime.subscribe, runtime.getRevision, runtime.getRevision);
  return (
    <>
      {(surfaceId ? [surfaceId] : runtime.surfaceIds).map((id) => (
        <NativeNode key={id} surfaceId={id} id="root" />
      ))}
    </>
  );
}
const NativeNode = memo(function NativeNode({
  surfaceId,
  id,
  scope = "/",
}: {
  surfaceId: string;
  id: string;
  scope?: string;
}) {
  const { runtime, kit, mode, components } = useUI();
  const colors = kit.tokens[mode];
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
      <Text accessibilityRole="alert" style={{ color: colors.danger, padding: 12 }}>
        이 항목을 표시할 수 없습니다. {node.error}
      </Text>
    );
  if (!node.component)
    return (
      <View
        accessibilityLabel="콘텐츠 불러오는 중"
        style={{
          height: 24,
          backgroundColor: colors.border,
          opacity: 0.4,
          borderRadius: 6,
          marginVertical: 8,
        }}
      />
    );
  if (node.props.visible === false) return null;
  const renderChild = (childId: string, childScope = scope) => (
    <NativeNode
      key={`${childId}:${childScope}`}
      id={childId}
      surfaceId={surfaceId}
      scope={childScope}
    />
  );
  const childList = node.props.children as ChildList | undefined;
  let children: ReactNode = null;
  if (Array.isArray(childList)) children = childList.map((child) => renderChild(child));
  else if (childList) {
    const values = runtime.read(surfaceId, childList.path, scope);
    if (Array.isArray(values))
      children = values
        .slice(0, 1000)
        .map((_, index) =>
          renderChild(childList.componentId, `${resolvePath(childList.path, scope)}/${index}`),
        );
  }
  const implementation = kit.components[node.component]?.implementation;
  const fallback = kit.components[node.component]?.fallback;
  const Widget =
    components[implementation ?? ""] ??
    components[node.component] ??
    components[fallback ?? ""] ??
    NativeView;
  return (
    <NativeBoundary key={`${id}:${node.component}`}>
      <Widget node={node} runtime={runtime} surfaceId={surfaceId} renderChild={renderChild}>
        {children}
      </Widget>
    </NativeBoundary>
  );
});

class NativeBoundary extends React.Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Text accessibilityRole="alert">이 항목을 표시할 수 없습니다.</Text>
    ) : (
      this.props.children
    );
  }
}
function NativeView({ node, runtime, surfaceId, children, renderChild }: NativeViewProps) {
  const { kit, mode, assets } = useUI();
  const t = kit.tokens[mode];
  const p = node.props;
  const [dateOpen, setDateOpen] = useState(false);
  const [showData, setShowData] = useState(false);
  const bound = node.raw?.value as { path?: string } | undefined;
  const write = (value: unknown) => {
    if (bound?.path) runtime.setValue(surfaceId, bound.path, value, node.scope);
  };
  const label = String(p.label ?? "");
  const value = p.value ?? "";
  const disabled = Boolean(p.disabled) || !bound?.path;
  const body = { color: t.foreground, fontSize: 16, lineHeight: 25 } as const;
  const container = {
    gap: kit.tokens.spacing[(p.gap ?? "md") as keyof UIKit["tokens"]["spacing"]],
  };
  const control = {
    minHeight: 48,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 6,
    paddingHorizontal: 12,
    color: t.foreground,
    backgroundColor: t.surface,
    fontSize: 16,
  };
  const button = (
    title: string,
    onPress: () => void,
    secondary = false,
    isDisabled = false,
    role: "button" | "tab" = "button",
    selected?: boolean,
  ) => (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={title}
      accessibilityState={{ disabled: isDisabled, selected }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: kit.id === "editorial" ? 4 : 8,
        backgroundColor: secondary ? t.surface : t.accent,
        borderWidth: secondary ? 1 : 0,
        borderColor: t.border,
        opacity: isDisabled ? 0.5 : pressed ? 0.75 : 1,
        justifyContent: "center",
      })}
    >
      <Text
        style={{ color: secondary ? t.foreground : t.onAccent, fontSize: 16, fontWeight: "600" }}
      >
        {title}
      </Text>
    </Pressable>
  );
  const field = (widget: ReactNode) => (
    <View style={{ gap: 8 }}>
      <Text style={{ ...body, fontSize: 14, fontWeight: "600" }}>{label}</Text>
      {widget}
      {p.error && (
        <Text accessibilityRole="alert" style={{ color: t.danger }}>
          {String(p.error)}
        </Text>
      )}
    </View>
  );
  switch (node.component) {
    case "Form":
      return (
        <View style={container} accessibilityLabel={label}>
          {children}
          {button("제출", () => {
            void runtime.dispatch(surfaceId, node.id, p.onSubmit, node.scope);
          })}
        </View>
      );
    case "Column":
      return <View style={container}>{children}</View>;
    case "Row":
      return (
        <View style={{ ...container, flexDirection: "row", flexWrap: "wrap" }}>
          {React.Children.map(children, (child) => (
            <View style={{ flexGrow: 1, flexBasis: 120 }}>{child}</View>
          ))}
        </View>
      );
    case "Grid":
      return <View style={container}>{children}</View>;
    case "Card":
      return (
        <View
          style={{
            backgroundColor: t.surface,
            borderWidth: 1,
            borderColor: t.border,
            borderRadius: kit.tokens.radius,
            padding: 18,
            gap: 16,
          }}
        >
          {p.title && (
            <Text
              accessibilityRole="header"
              style={{
                ...body,
                fontWeight: "600",
                fontSize: 20,
                fontFamily:
                  kit.id === "editorial"
                    ? Platform.OS === "ios"
                      ? "Georgia"
                      : "serif"
                    : undefined,
                paddingBottom: kit.id === "editorial" ? 12 : 0,
                borderBottomWidth: kit.id === "editorial" ? 1 : 0,
                borderColor: t.border,
              }}
            >
              {String(p.title)}
            </Text>
          )}
          {children}
        </View>
      );
    case "Divider":
      return <View style={{ height: 1, backgroundColor: t.border, marginVertical: 8 }} />;
    case "Heading":
      return (
        <Text
          accessibilityRole="header"
          testID={`node-${node.id}`}
          style={{
            color: t.foreground,
            fontSize: p.level === 1 ? 30 : p.level === 2 ? 26 : 21,
            lineHeight: p.level === 1 ? 38 : 32,
            fontWeight: kit.id === "editorial" ? "500" : "600",
            fontFamily:
              kit.id === "editorial" ? (Platform.OS === "ios" ? "Georgia" : "serif") : undefined,
          }}
        >
          {String(p.text ?? "")}
        </Text>
      );
    case "Text":
      return (
        <Text
          testID={`node-${node.id}`}
          style={{
            ...body,
            color:
              p.tone === "muted"
                ? t.muted
                : p.tone === "danger"
                  ? t.danger
                  : p.tone === "success"
                    ? t.success
                    : t.foreground,
          }}
        >
          {String(p.text ?? "")}
        </Text>
      );
    case "Image":
      return assets[p.asset] ? (
        <Image
          source={assets[p.asset]}
          accessibilityLabel={p.alt}
          style={{
            width: "100%",
            aspectRatio: p.aspectRatio ?? 2,
            borderRadius: kit.tokens.radius,
          }}
          resizeMode="contain"
        />
      ) : (
        <View
          accessibilityRole="image"
          accessibilityLabel={p.alt}
          style={{ padding: 28, borderWidth: 1, borderColor: t.border, borderStyle: "dashed" }}
        >
          <Text style={{ ...body, color: t.muted }}>{p.alt}</Text>
        </View>
      );
    case "Icon":
      return <NativeIcon name={p.name} label={p.label} color={t.foreground} />;
    case "Badge":
      return (
        <View
          style={{
            alignSelf: "flex-start",
            paddingHorizontal: 12,
            paddingVertical: 5,
            borderWidth: 1,
            borderColor: t.border,
            borderRadius: 20,
          }}
        >
          <Text style={{ color: p.tone === "success" ? t.success : t.foreground, fontSize: 13 }}>
            {String(p.text ?? "")}
          </Text>
        </View>
      );
    case "Callout":
      return (
        <View
          style={{
            padding: 18,
            borderWidth: 1,
            borderColor: t.border,
            backgroundColor: t.surface,
            borderRadius: kit.tokens.radius,
            gap: 6,
          }}
        >
          <Text style={{ ...body, fontWeight: "600" }}>{String(p.title)}</Text>
          <Text style={body}>{String(p.text)}</Text>
        </View>
      );
    case "CodeBlock":
      return (
        <ScrollView
          horizontal
          style={{
            backgroundColor: t.surface,
            borderWidth: 1,
            borderColor: t.border,
            borderRadius: 6,
          }}
        >
          <Text
            selectable
            style={{
              color: t.foreground,
              fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
              fontSize: 14,
              lineHeight: 22,
              padding: 16,
            }}
          >
            {String(p.code ?? "")}
          </Text>
        </ScrollView>
      );
    case "List":
      return (
        <View style={{ gap: 10 }}>
          {React.Children.map(children, (child, index) => (
            <View style={{ flexDirection: "row", gap: 12 }}>
              {p.ordered && <Text style={body}>{index + 1}.</Text>}
              <View style={{ flex: 1 }}>{child}</View>
            </View>
          ))}
        </View>
      );
    case "Table":
      return <NativeTable title={String(p.caption)} columns={p.columns} rows={p.rows} />;
    case "Progress":
      return (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={label}
          accessibilityValue={{ min: 0, max: p.max, now: Number(value) || 0 }}
          style={{ gap: 8 }}
        >
          <Text style={body}>
            {label}: {String(value)} / {p.max}
          </Text>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.border }}>
            <View
              style={{
                height: 8,
                borderRadius: 4,
                width: `${Math.min(100, Math.max(0, (Number(value) / p.max) * 100))}%`,
                backgroundColor: t.accent,
              }}
            />
          </View>
        </View>
      );
    case "Button":
      return button(
        String(p.label),
        () => {
          void runtime.dispatch(surfaceId, node.id, p.action, node.scope);
        },
        p.variant !== "primary",
        Boolean(p.disabled),
      );
    case "TextField":
      return field(
        <TextInput
          accessibilityLabel={label}
          testID={`input-${node.id}`}
          style={{
            ...control,
            minHeight: p.multiline ? 96 : 48,
            textAlignVertical: p.multiline ? "top" : "center",
            paddingVertical: 12,
          }}
          value={String(value)}
          onChangeText={write}
          editable={!disabled}
          multiline={p.multiline}
          placeholder={p.placeholder}
          placeholderTextColor={t.muted}
        />,
      );
    case "Select":
      return field(
        <View style={{ ...control, paddingHorizontal: 0 }}>
          <Picker
            accessibilityLabel={label}
            selectedValue={value}
            enabled={!disabled}
            onValueChange={write}
            dropdownIconColor={t.foreground}
            style={{ color: t.foreground }}
          >
            {p.options.map((o: { label: string; value: string }) => (
              <Picker.Item key={o.value} label={o.label} value={o.value} />
            ))}
          </Picker>
        </View>,
      );
    case "Checkbox":
      return (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={label}
          accessibilityState={{ checked: Boolean(value), disabled }}
          disabled={disabled}
          onPress={() => write(!value)}
          style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 }}
        >
          <View
            style={{
              width: 24,
              height: 24,
              borderWidth: 1,
              borderColor: value ? t.accent : t.border,
              backgroundColor: value ? t.accent : t.surface,
              borderRadius: 4,
            }}
          >
            {Boolean(value) && <NativeIcon name="check" color={t.onAccent} />}
          </View>
          <Text style={{ ...body, flex: 1 }}>{label}</Text>
        </Pressable>
      );
    case "Slider":
      return field(
        <View>
          <Slider
            accessibilityLabel={label}
            testID={`input-${node.id}`}
            disabled={disabled}
            value={Number(value) || 0}
            minimumValue={p.min}
            maximumValue={p.max}
            step={p.step}
            onValueChange={write}
            minimumTrackTintColor={t.accent}
            maximumTrackTintColor={t.border}
            thumbTintColor={t.accent}
            style={{ height: 48, width: "100%" }}
          />
          <Text
            testID={`value-${node.id}`}
            style={{ ...body, textAlign: "right", fontVariant: ["tabular-nums"] }}
          >
            {String(value)}
          </Text>
        </View>,
      );
    case "DatePicker":
      return field(
        <View>
          {button(String(value || "날짜 선택"), () => setDateOpen(true), true, disabled)}
          {dateOpen && (
            <DateTimePicker
              value={new Date(`${value || "2026-01-01"}T12:00:00`)}
              mode="date"
              onChange={(_, date) => {
                setDateOpen(false);
                if (date)
                  write(
                    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
                  );
              }}
              minimumDate={p.min ? new Date(p.min) : undefined}
              maximumDate={p.max ? new Date(p.max) : undefined}
            />
          )}
        </View>,
      );
    case "Tabs": {
      const selected = p.tabs.find((tab: any) => tab.id === value) ?? p.tabs[0];
      return (
        <View style={{ gap: 20 }}>
          <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
            {p.tabs.map((tab: any) => (
              <View key={tab.id}>
                {button(
                  String(runtime.resolve(surfaceId, tab.label, node.scope)),
                  () => write(tab.id),
                  tab !== selected,
                  false,
                  "tab",
                  tab === selected,
                )}
              </View>
            ))}
          </ScrollView>
          {renderChild(selected.child)}
        </View>
      );
    }
    case "Accordion":
      return (
        <View>
          {p.items.map((item: any) => (
            <View
              key={item.id}
              style={{ borderBottomWidth: 1, borderColor: t.border, paddingVertical: 8 }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={String(item.label)}
                accessibilityState={{ expanded: value === item.id }}
                onPress={() => write(value === item.id ? "" : item.id)}
                style={{
                  minHeight: 48,
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Text style={{ ...body, flex: 1 }}>
                  {String(runtime.resolve(surfaceId, item.label, node.scope))}
                </Text>
                <NativeIcon name="plus" color={t.foreground} />
              </Pressable>
              {value === item.id && (
                <View style={{ paddingVertical: 12 }}>{renderChild(item.child)}</View>
              )}
            </View>
          ))}
        </View>
      );
    case "Chart":
      return (
        <View style={{ gap: 12 }}>
          <NativeChart node={node} />
          {button(
            showData ? "데이터 표 닫기" : "데이터 표 보기",
            () => setShowData(!showData),
            true,
          )}
          {showData && (
            <NativeTable
              title={String(p.title)}
              columns={[
                { key: p.xKey, label: p.xKey },
                { key: p.yKey, label: p.yKey },
              ]}
              rows={p.values}
            />
          )}
        </View>
      );
    default:
      return (
        <Text accessibilityRole="alert" style={{ color: t.danger }}>
          등록되지 않은 컴포넌트: {node.component}
        </Text>
      );
  }
}
function NativeIcon({ name, label, color }: { name: string; label?: string; color: string }) {
  const paths: Record<string, string> = {
    check: "m5 12 4 4L19 6",
    info: "M12 10v7m0-10v.1",
    arrow: "M4 12h15m-6-6 6 6-6 6",
    plus: "M12 5v14M5 12h14",
    star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z",
    close: "m6 6 12 12M6 18 18 6",
  };
  return (
    <Svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      accessible={Boolean(label)}
      accessibilityLabel={label}
    >
      <Path
        d={paths[name] ?? paths.info}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
function NativeTable({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: { key: string; label: string }[];
  rows: any;
}) {
  const { kit, mode } = useUI();
  const t = kit.tokens[mode];
  const cell = { padding: 12, width: 150, color: t.foreground, fontSize: 14, lineHeight: 22 };
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: t.muted, fontSize: 14 }}>
        {title}
      </Text>
      <ScrollView horizontal>
        <View>
          <View style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: t.border }}>
            {columns.map((c) => (
              <Text key={c.key} style={{ ...cell, fontWeight: "600" }}>
                {c.label}
              </Text>
            ))}
          </View>
          {(Array.isArray(rows) ? rows : []).map((row: any, index: number) => (
            <View
              key={row.id ?? index}
              style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: t.border }}
            >
              {columns.map((c) => (
                <Text key={c.key} style={cell}>
                  {String(row[c.key] ?? "")}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
function NativeChart({ node }: { node: NodeSnapshot }) {
  const { kit, mode } = useUI();
  const t = kit.tokens[mode];
  const p = node.props;
  const points = (Array.isArray(p.values) ? p.values : []).filter(
    (v: any) => typeof v?.[p.yKey] === "number" && Number.isFinite(v[p.yKey]),
  );
  const min = Math.min(0, ...points.map((v: any) => v[p.yKey]));
  const max = Math.max(1, ...points.map((v: any) => v[p.yKey]));
  const x = (i: number) => 38 + (i * 276) / Math.max(points.length - 1, 1);
  const y = (v: number) => 174 - ((v - min) / (max - min)) * 142;
  return (
    <View style={{ gap: 8 }}>
      <Text
        accessibilityRole="header"
        style={{ color: t.foreground, fontSize: 18, fontWeight: "600" }}
      >
        {String(p.title)}
      </Text>
      <Svg
        width="100%"
        height={220}
        viewBox="0 0 360 220"
        accessibilityRole="image"
        accessibilityLabel={`${p.title}. ${points.length}개 값. 최솟값 ${min}, 최댓값 ${max}`}
      >
        {[0, 0.5, 1].map((fraction) => {
          const val = min + (max - min) * fraction;
          return (
            <React.Fragment key={fraction}>
              <Line x1={38} x2={336} y1={y(val)} y2={y(val)} stroke={t.border} />
              <SvgText x={30} y={y(val) + 4} textAnchor="end" fill={t.muted} fontSize={12}>
                {Math.round(val * 10) / 10}
              </SvgText>
            </React.Fragment>
          );
        })}
        {p.kind === "line" && (
          <Polyline
            points={points.map((v: any, i: number) => `${x(i)},${y(v[p.yKey])}`).join(" ")}
            fill="none"
            stroke={t.accent}
            strokeWidth={3}
          />
        )}
        {points.map((v: any, i: number) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: SVG marks have no local state and duplicate coordinates are valid.
          <React.Fragment key={i}>
            {p.kind === "bar" ? (
              <Rect
                x={x(i) - 14}
                y={Math.min(y(0), y(v[p.yKey]))}
                width={28}
                height={Math.max(1, Math.abs(y(v[p.yKey]) - y(0)))}
                fill={t.accent}
                rx={2}
              />
            ) : (
              <Circle cx={x(i)} cy={y(v[p.yKey])} r={4} fill={t.accent} />
            )}
            <SvgText x={x(i)} y={202} textAnchor="middle" fill={t.muted} fontSize={12}>
              {String(v[p.xKey] ?? i + 1).slice(0, 8)}
            </SvgText>
          </React.Fragment>
        ))}
      </Svg>
    </View>
  );
}
