{@state period = "half"}
{@let all = [8, 11, 9, 14, 12, 16, 12, 18, 15, 28, 36, 42]}
{@let data = period === "half" ? all.slice(6) : all}
{@let first = period === "half" ? 7 : 1}
{@let top = Math.max(...data) * 1.15}
{@let H = 180}
{@let bw = 300 / data.length}
{@state picked = -1}
<box gap={3}>
  <col gap={0}>
    <title>월별 사용량</title>
    <caption>예시 데이터 · 단위: 천 건</caption>
  </col>
  <segmented value={period} onChange={() => picked = -1} options={[{label: "6개월", value: "half"}, {label: "1년", value: "year"}]}/>
  <svg viewBox="0 0 300 206">
    {#each [0.25, 0.5, 0.75, 1] as g}
      <line x1={0} x2={300} y1={H - g * H / 1.15} y2={H - g * H / 1.15} stroke="border" stroke-dasharray="3 4"/>
    {/each}
    {#each data as v, i}
      <rect x={i * bw + bw * 0.14} y={H - v / top * H} width={bw * 0.72} height={v / top * H} rx={Math.min(8, bw * 0.2)} fill={picked === -1 || picked === i ? "blue" : "blue-200"} onPress={() => picked = picked === i ? -1 : i}/>
      {#if data.length <= 6 || picked === i || i === data.length - 1}
        <text x={i * bw + bw / 2} y={H - v / top * H - 6} text-anchor="middle" font-size={11} font-weight="bold">{v}</text>
      {/if}
      <text x={i * bw + bw / 2} y={H + 20} text-anchor="middle" font-size={10} fill="muted">{first + i}월</text>
    {/each}
  </svg>
  <caption>{picked >= 0 ? `${first + picked}월: ${data[picked]}천 건` : "막대를 누르면 값이 보여요."}</caption>
</box>
