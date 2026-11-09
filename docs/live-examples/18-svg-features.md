{@state t = 0.6}
{@let pts = Array.from({length: 40}, (_, i) => [i * 8, 70 - Math.sin(i / 4) * 40 * t - i * 0.6])}
<box gap={3}>
  <title>그라데이션, 화살표, 곡선</title>
  <svg viewBox="0 0 312 150">
    <defs>
      <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="violet" stop-opacity={0.45}/>
        <stop offset="1" stop-color="violet" stop-opacity={0}/>
      </linearGradient>
      <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="muted"/>
      </marker>
      <clipPath id="left"><rect x={0} y={0} width={312 * t} height={150}/></clipPath>
    </defs>
    <polygon points={[...pts, [312, 150], [0, 150]]} fill="url(#area)"/>
    <polyline points={pts} fill="none" stroke="violet" stroke-width={2.5} stroke-linecap="round" stroke-linejoin="round"/>
    <line x1={8} y1={142} x2={300} y2={142} stroke="muted" marker-end="url(#arrow)"/>
    <g clip-path="url(#left)">
      <circle cx={156} cy={70} r={46} fill="orange" opacity={0.35}/>
    </g>
    <text x={156} y={74} text-anchor="middle" font-size={14} font-weight="bold">값 <tspan fill="violet">{t.toFixed(2)}</tspan></text>
  </svg>
  <slider label="진폭" min={0} max={1} step={0.01} value={t}/>
</box>
