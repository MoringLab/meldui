{@state a = 1}
{@state f = 2}
{@state phase = 0}
{@let pts = range(91).map(i => [i / 90 * 300, 80 - a * 30 * Math.sin(f * i / 90 * Math.PI * 2 + phase)])}
<box gap={3}>
  <col gap={0}>
    <title>y = a · sin(f · x + φ)</title>
    <caption>슬라이더를 움직이면 그래프가 바로 바뀌어요.</caption>
  </col>
  <svg viewBox="0 0 300 160">
    <line x1={0} y1={80} x2={300} y2={80} stroke="border"/>
    {#each [1, 2, 3] as q}
      <line x1={q * 75} y1={6} x2={q * 75} y2={154} stroke="border" stroke-dasharray="2 4"/>
    {/each}
    <polyline points={pts} fill="none" stroke="blue" stroke-width={2.5} stroke-linejoin="round"/>
  </svg>
  <slider label="진폭 a" min={0} max={2.5} step={0.05} value={a}/>
  <slider label="주파수 f" min={0.5} max={6} step={0.1} value={f}/>
  <slider label="위상 φ" min={0} max={6.28} step={0.01} value={phase}/>
</box>
