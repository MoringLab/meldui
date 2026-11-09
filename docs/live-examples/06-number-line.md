<box gap={3}>
  <col gap={1}>
    <text>• 디스크 범위: 0~100</text>
    <text>• 현재 헤드 위치: **50**</text>
    <text>• 요청 위치: **10, 20, 35, 65, 80, 90**</text>
    <text>• 최초 진행 방향: **오른쪽(큰 숫자 방향)**</text>
  </col>
  <svg viewBox="0 0 320 84">
    <line x1={14} y1={40} x2={306} y2={40} stroke="muted" stroke-width={3} stroke-linecap="round"/>
    {#each [0, 10, 20, 35, 50, 65, 80, 90, 100] as p}
      <circle cx={14 + p * 2.92} cy={40} r={p === 50 ? 9 : 6} fill={p === 50 ? "orange" : p === 0 || p === 100 ? "gray-400" : "blue"} stroke={p === 50 ? "white" : "none"} stroke-width={2}/>
      <text x={14 + p * 2.92} y={20} text-anchor="middle" font-size={11}>{p}</text>
    {/each}
    <line x1={160} y1={62} x2={204} y2={62} stroke="orange" stroke-width={2.5} stroke-linecap="round"/>
    <polygon points="204,56.5 213,62 204,67.5" fill="orange"/>
    <text x={186} y={80} text-anchor="middle" font-size={11} fill="orange">진행 방향 →</text>
  </svg>
</box>
