{@state run = true}
{@state t = 0}
{@state L = 1.2}
{@state g = 9.8}
{@state a0 = 40}
{@body useInterval(() => { t += 0.033 }, run ? 33 : null)}
{@let w = Math.sqrt(g / L)}
{@let th = a0 * Math.PI / 180 * Math.cos(w * t)}
{@let len = 60 + L * 70}
{@let x = 150 + len * Math.sin(th)}
{@let y = 16 + len * Math.cos(th)}
{@let period = 2 * Math.PI / w}
<box gap={3}>
  <row justify="between">
    <title>진자 운동</title>
    <badge tone={run ? "success" : "default"}>{run ? "재생 중" : "정지"}</badge>
  </row>
  <svg viewBox="0 0 300 220">
    <line x1={110} x2={190} y1={16} y2={16} stroke="muted" stroke-width={2} stroke-linecap="round"/>
    <path d={`M ${150 - len * Math.sin(a0 * Math.PI / 180)} ${16 + len * Math.cos(a0 * Math.PI / 180)} A ${len} ${len} 0 0 0 ${150 + len * Math.sin(a0 * Math.PI / 180)} ${16 + len * Math.cos(a0 * Math.PI / 180)}`} fill="none" stroke="border" stroke-dasharray="3 5"/>
    <line x1={150} y1={16} x2={x} y2={y} stroke="foreground" stroke-width={1.5}/>
    <circle cx={150} cy={16} r={3} fill="foreground"/>
    <circle cx={x} cy={y} r={13} fill="blue"/>
    <text x={150} y={214} text-anchor="middle" font-size={11} fill="muted">주기 {period.toFixed(2)}초</text>
  </svg>
  <slider label="줄 길이" min={0.3} max={2} step={0.1} value={L} unit="m"/>
  <slider label="중력" min={1} max={20} step={0.1} value={g} unit=" m/s²"/>
  <slider label="시작 각도" min={5} max={70} value={a0} unit="°"/>
  <row gap={2}>
    <button flex={1} icon={run ? "pause" : "play"} onPress={() => run = !run}>{run ? "정지" : "재생"}</button>
    <button variant="outline" icon="rotate-ccw" onPress={() => t = 0}>처음부터</button>
  </row>
</box>
