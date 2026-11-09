{@state angle = 45}
{@state speed = 20}
{@state t = 0}
{@state flying = false}
{@let g = 9.8}
{@let rad = angle * Math.PI / 180}
{@let vx = speed * Math.cos(rad)}
{@let vy = speed * Math.sin(rad)}
{@let T = 2 * vy / g}
{@let reach = vx * T}
{@let peak = vy * vy / (2 * g)}
{@let k = 3.1}
{@let px = s => 12 + vx * s * k}
{@let py = s => 186 - (vy * s - g * s * s / 2) * k}
{@let path = range(41).map(i => [px(T * i / 40), py(T * i / 40)])}
{@body useInterval(() => { if (t + 0.05 >= T) { t = T; flying = false } else t += 0.05 }, flying ? 33 : null)}
<box gap={3}>
  <row justify="between">
    <title>포물선 운동</title>
    <badge tone={flying ? "info" : "default"}>{flying ? "비행 중" : t > 0 ? "착지" : "대기"}</badge>
  </row>
  <svg viewBox="0 0 320 200">
    <line x1={0} y1={186} x2={320} y2={186} stroke="border" stroke-width={1.5}/>
    <polyline points={path} fill="none" stroke="muted" stroke-dasharray="4 5" stroke-width={1.5}/>
    <line x1={px(T / 2)} y1={186} x2={px(T / 2)} y2={py(T / 2)} stroke="border" stroke-dasharray="2 3"/>
    <text x={px(T / 2)} y={py(T / 2) - 8} text-anchor="middle" font-size={10} fill="muted">{peak.toFixed(1)} m</text>
    <circle cx={px(t)} cy={py(t)} r={7} fill="orange"/>
  </svg>
  <grid columns={3} gap={2}>
    {#each [["비행 시간", `${T.toFixed(2)}초`], ["최고 높이", `${peak.toFixed(1)} m`], ["도달 거리", `${reach.toFixed(1)} m`]] as [label, value]}
      <box bg="surface" radius="lg" padding={3} gap={1}>
        <caption>{label}</caption>
        <text weight="bold" tabularNums>{value}</text>
      </box>
    {/each}
  </grid>
  <slider label="발사 각도" unit="°" min={10} max={80} value={angle} onChange={() => { t = 0; flying = false }}/>
  <slider label="초기 속도" unit=" m/s" min={5} max={30} value={speed} onChange={() => { t = 0; flying = false }}/>
  <button block icon={flying ? "pause" : "play"} onPress={() => { if (!flying && t >= T) t = 0; flying = !flying }}>{flying ? "일시정지" : "발사"}</button>
</box>
