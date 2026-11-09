{@state n = 0}
{@let self = self + 1}
{@let boom = (() => { throw "x" })()}
{@let forever = (() => { while (true) {} })()}
{@let huge = Array.from({length: 1e9}, (_, i) => i)}
{@let deep = JSON.parse("{")}
{@body useInterval(() => { while (true) {} }, 10)}
<box gap={3} width={1e9} height={-5} padding="abc" bg="not-a-colour" radius={NaN} opacity={99} style={{position: "fixed", foo: {bar: 1}, width: "calc(1+1)"}}>
  <text size={-3} weight={12345} color={{a: 1}} lines={-1}>{undefined}{null}{{a: 1}}{[1, [2]]}{self}{boom}{nope.nope.nope}{forever}</text>
  <h1 size="enormous">제목은 그대로 보여야 해요</h1>
  <svg viewBox="garbage"><path d="not a path at all"/><circle r={NaN} cx="x"/><rect width="abc"/><polyline points={[[1], "x", {y: 2}, null]}/><text>{nope}</text><text x="a"><tspan>글자</tspan></text>벌거벗은 글자</svg>
  <svg viewBox="0 0 0 0" width={-10}><circle r={1e30}/></svg>
  <svg viewBox="0 0 100 100"><linearGradient/><stop/><use href="#none"/><image href="file:///etc/passwd"/><marker/><mask/><pattern/><svg><g><g><g><foreignObject>이상한 것</foreignObject></g></g></g></svg></svg>
  <image src="javascript:alert(1)"/>
  <image src="file:///etc/passwd" aspectRatio="x:y"/>
  <image src="https://invalid.invalid/nope.png"/>
  <slider min={5} max={1} step={0} value={NaN}/>
  <slider value={n} min="a" max="b"/>
  <select options={null}/>
  <segmented options={[null, 1, {}, {label: {x: 1}}]} value={undefined}/>
  <grid columns={0}><text>칸</text></grid>
  <grid columns={1000}><text>칸</text></grid>
  {#each 1000000 as x}<text>안 그려져요</text>{/each}
  {#each huge as x}<text>{x}</text>{/each}
  {#each null as x}<text>{x}</text>{/each}
  {#if boom}<text>안 보여요</text>{:else}<text>else는 보여요</text>{/if}
  <button onPress={() => { while (true) {} }}>무한 루프 버튼</button>
  <button onPress={() => nope.call()} disabled="maybe">오류 버튼</button>
  <button onPress={() => n = "글자"}>숫자 자리에 글자</button>
  <input value={{}} type="number"/>
  <progress value="a" max={0}/>
  <icon name="no-such-icon-at-all" size={1e9}/>
  <badge tone={{}}>뱃지</badge>
  <Chart values={null}/>
  <Chart kind="bogus" values={[{x: 1}]} xKey="q" yKey="r"/>
  <Table rows={"x"} columns={1}/>
  <Formula latex={{}}/>
  <Calendar month="garbage" events={1}/>
  <Diagram kind="nope"><Node/><Edge/></Diagram>
  <Nonsense foo={1}><text>모르는 태그 안의 글자</text></Nonsense>
  <script>alert(1)</script>
  <style>body {}</style>
  <text>끝까지 왔어요</text>
</box>
