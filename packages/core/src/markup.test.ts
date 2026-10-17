import { CATALOG_ID } from "@engine/protocol";
import { describe, expect, it } from "vitest";
import { createUIRuntime } from "./index.js";
import { compileMarkup, isMarkupStart, markupOpen } from "./markup.js";

const byId = (c: ReturnType<typeof compileMarkup>) =>
  Object.fromEntries(c.components.map((x) => [x.id, x]));

/** Renders compiled markup in a runtime and returns its diagnostics (errors only). */
function render(source: string) {
  const runtime = createUIRuntime();
  const out = compileMarkup(source, { final: true });
  runtime.accept({ version: "v0.9", createSurface: { surfaceId: "s", catalogId: CATALOG_ID } });
  for (const [path, value] of Object.entries(out.data))
    runtime.accept({ version: "v0.9", updateDataModel: { surfaceId: "s", path, value } });
  runtime.accept({
    version: "v0.9",
    updateComponents: { surfaceId: "s", components: out.components },
  });
  const errors = runtime.diagnostics.filter((d) => d.severity === "error");
  return { runtime, out, errors };
}

const DIL = `{@body const [seats,setSeats] = DIL.useState(8)}
{@body const price = seats*29}
<box border padding={3} gap={2}>
  <slider min={1} max={50} value={seats} onChange={setSeats}/>
  <title size="xl">\${price}/mo</title>
</box>`;

describe("markup", () => {
  it("compiles the DIL example: state, derived value, binding, interpolation", () => {
    const { out, errors, runtime } = render(DIL);
    expect(errors).toEqual([]);
    expect(out.data).toEqual({ "/seats": 8 });
    const c = byId(out);
    const slider = out.components.find((x) => x.component === "Slider");
    expect(slider?.value).toEqual({ path: "/seats" });
    const heading = out.components.find((x) => x.component === "Heading");
    expect(JSON.stringify(heading?.text)).toContain("(/seats*29)");
    expect(c.root?.children).toHaveLength(1);
    expect(runtime.read("s", "/seats")).toBe(8);
  });

  it("repeats rows with each, and folds if/else into visible", () => {
    const { out, errors } =
      render(`{@state items = [{name: '사과', done: false}, {name: '배', done: true}]}
{@state show = true}
<Column>
  {#each items as item, i}
  <Box direction="row" justify="between">
    <Checkbox label={item.name} value={item.done}/>
    <Button label="삭제" icon="x" iconOnly onPress={items = filter(items, $index != i)}/>
  </Box>
  {/each}
  {#if show}<Text>보여요</Text>{:else}<Text>숨김</Text>{/if}
</Column>`);
    expect(errors).toEqual([]);
    const column = out.components.find((x) => x.component === "Column" && x.id !== "root");
    expect(column?.children).toEqual({ componentId: expect.any(String), path: "/items" });
    const check = out.components.find((x) => x.component === "Checkbox");
    expect(check?.value).toEqual({ path: "done" });
    const remove = out.components.find((x) => x.component === "Button") as any;
    expect(remove.action.functionCall.args).toEqual({
      path: "/items",
      formula: "filter(/items, $index != $rowIndex)",
    });
    const texts = out.components.filter((x) => x.component === "Text");
    expect(texts.map((t: any) => t.visible.args.formula)).toEqual(["(/show)", "!(/show)"]);
  });

  it("fills array props from child tags: tabs, table columns and rows", () => {
    const { out, errors } = render(`<Tabs>
  <Tab label="개요"><Text>첫 화면</Text></Tab>
  <Tab label="상세"><Text>둘째</Text><Badge>NEW</Badge></Tab>
</Tabs>
<Table caption="비교">
  <Column key="name" label="이름"/>
  <Column key="price" label="가격"/>
  <Row name="A" price={1000}/>
  <Row name="B" price={2000}/>
</Table>`);
    expect(errors).toEqual([]);
    const tabs = out.components.find((x) => x.component === "Tabs") as any;
    expect(tabs.tabs.map((t: any) => t.label)).toEqual(["개요", "상세"]);
    const table = out.components.find((x) => x.component === "Table") as any;
    expect(table.columns).toEqual([
      { key: "name", label: "이름" },
      { key: "price", label: "가격" },
    ]);
    expect(table.rows).toEqual([
      { name: "A", price: 1000 },
      { name: "B", price: 2000 },
    ]);
  });

  it("turns handlers into local actions", () => {
    const { out } = render(`{@state n = 0}{@state on = false}
<Button label="+" onPress={n++}/>
<Button label="토글" onPress={() => { toggle(on); n = 0 }}/>
<Button label="질문" onPress={ask("더 알려줘")}/>
<Button label="보내기" onPress={send("예시 더 보여줘")}/>`);
    const [inc, both, ask, send] = out.components.filter((x) => x.component === "Button") as any[];
    expect(inc.action.functionCall).toEqual({
      call: "setValue",
      args: { path: "/n", formula: "/n + 1" },
    });
    expect(both.action.functionCall.args.updates).toEqual([
      { path: "/on", formula: "!/on" },
      { path: "/n", value: 0 },
    ]);
    expect(ask.action).toEqual({ event: { name: "ask", context: { text: "더 알려줘" } } });
    expect(send.action).toEqual({ event: { name: "send", context: { text: "예시 더 보여줘" } } });
  });

  it("keeps Markdown raw and text in the fallback", () => {
    const out = compileMarkup(
      `<Box direction="row">
  <Image attachmentId="i1" alt="후지산"/>
  <Markdown>
    **후지산** · 가와구치호
    - 해발 3,776m
  </Markdown>
</Box>`,
      { final: true },
    );
    const md = out.components.find((x) => x.component === "Markdown") as any;
    expect(md.text).toBe("**후지산** · 가와구치호\n- 해발 3,776m");
    expect(out.text).toContain("후지산");
  });

  it("compiles every streamed prefix without throwing, and ids never change", () => {
    const source = `{@state tab = 'a'}
<Box tone="subtle" padding="md">
  <Heading>제목 {tab}</Heading>
  <Text>설명 문장이에요</Text>
  <Tabs value={tab}><Tab label="A"><Text>a</Text></Tab><Tab label="B"><Text>b</Text></Tab></Tabs>
</Box>`;
    const full = byId(compileMarkup(source, { final: true }));
    for (let n = 1; n <= source.length; n++) {
      const part = compileMarkup(source.slice(0, n));
      for (const c of part.components) {
        expect(full[c.id]?.component, `prefix ${n}: ${c.id}`).toBe(c.component);
      }
    }
  });

  it("detects region starts and open regions", () => {
    expect(isMarkupStart('<Box gap="sm">')).toBe(true);
    expect(isMarkupStart("{@state x = 1}")).toBe(true);
    expect(isMarkupStart("<https://example.com>")).toBe(false);
    expect(isMarkupStart("일반 문장")).toBe(false);
    expect(markupOpen("<Box>\n<Text>a</Text>")).toBe(true);
    expect(markupOpen("<Box>\n<Text>a</Text>\n</Box>")).toBe(false);
  });
});
