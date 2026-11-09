{@state algo = "LOOK"}
{@state step = 0}
{@let orders = {
  "SCAN": [50, 65, 80, 90, 100, 35, 20, 10],
  "LOOK": [50, 65, 80, 90, 35, 20, 10],
  "C-SCAN": [50, 65, 80, 90, 100, 0, 10, 20, 35],
  "C-LOOK": [50, 65, 80, 90, 10, 20, 35]
}}
{@let notes = {"SCAN": "끝(100)까지 갔다가 돌아오기", "LOOK": "마지막 요청까지만 갔다가 돌아오기", "C-SCAN": "끝까지 간 뒤 0으로 건너가 다시 오른쪽으로", "C-LOOK": "마지막 요청 뒤 가장 작은 요청으로 건너가기"}}
{@let order = orders[algo]}
{@let X = p => 24 + p * 2.6}
{@let Y = i => 44 + i * 32}
{@let moved = order.slice(1, step + 1).reduce((s, p, i) => s + Math.abs(p - order[i]), 0)}
<box gap={3}>
  <text>알고리즘을 골라 헤드가 움직이는 경로를 봐.</text>
  <chips value={algo} options={Object.keys(orders)} onChange={() => step = 0}/>
  <col gap={0}>
    <title>{algo}</title>
    <caption>{notes[algo]}</caption>
  </col>
  <svg viewBox={`0 0 300 ${Y(order.length - 1) + 20}`}>
    {#each [0, 25, 50, 75, 100] as t}
      <text x={X(t)} y={18} text-anchor="middle" font-size={10} fill="muted">{t}</text>
      <line x1={X(t)} x2={X(t)} y1={26} y2={Y(order.length - 1) + 10} stroke="border" stroke-dasharray="2 4"/>
    {/each}
    <polyline points={order.map((p, i) => [X(p), Y(i)])} fill="none" stroke="muted" stroke-opacity={0.3} stroke-width={1.5}/>
    <polyline points={order.slice(0, step + 1).map((p, i) => [X(p), Y(i)])} fill="none" stroke="accent" stroke-width={2.5} stroke-linejoin="round"/>
    {#each order as p, i}
      <circle cx={X(p)} cy={Y(i)} r={i === step ? 8 : 5} fill={i === 0 ? "orange" : i <= step ? "accent" : "muted"} opacity={i <= step ? 1 : 0.35}/>
      <text x={X(p) + (p > 85 ? -12 : 12)} y={Y(i) + 4} text-anchor={p > 85 ? "end" : "start"} font-size={11} fill={i <= step ? "foreground" : "muted"}>{i === 0 ? `${p} 시작` : p}</text>
    {/each}
  </svg>
  <row justify="between">
    <caption>위에서 아래로 시간이 흘러요 ↓</caption>
    <caption tabularNums>{step + 1}/{order.length}단계, {moved}칸</caption>
  </row>
  <slider min={0} max={order.length - 1} step={1} value={step}/>
  <row gap={2}>
    <button variant="outline" size="sm" icon="chevron-left" disabled={step === 0} onPress={() => step--}>이전</button>
    <button variant="outline" size="sm" icon="rotate-ccw" onPress={() => step = 0}>처음부터</button>
    <spacer/>
    <button size="sm" icon="chevron-right" disabled={step >= order.length - 1} onPress={() => step++}>다음</button>
  </row>
</box>
