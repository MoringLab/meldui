{@state items = ["최초 헤드 위치를 확인했는가?", "요청이 들어온 순서를 확인했는가?", "디스크 범위와 최초 진행 방향을 확인했는가?", "SCAN과 LOOK의 차이를 적용했는가?", "C 방식의 되돌아가는 구간을 표시했는가?", "헤드 이동 거리에서 빠진 구간은 없는가?", "N-Step이라면 먼저 N개씩 묶었는가?"].map(t => ({t, done: false}))}
{@let done = items.filter(x => x.done).length}
<box gap={2}>
  <row justify="between">
    <text weight="semibold">문제 풀기 전후 확인</text>
    <text color="muted" tabularNums>{done}/{items.length}</text>
  </row>
  <progress value={done} max={items.length} size="sm" color={done === items.length ? "green" : "accent"}/>
  <col gap={0}>
    {#each items as it}
      <checkbox value={it.done} label={it.t}/>
    {/each}
  </col>
</box>
