{@state picked = []}
{@state checked = false}
{@let options = [
  {t: "SCAN: 138칸", ok: true, why: "50 → 70 → 90 → 99 → 30 → 10. 20+20+9+69+20 = 138칸"},
  {t: "C-SCAN: 140칸", ok: false, why: "50 → 70 → 90 → 99 → 0 → 10 → 30. 20+20+9+99+10+20 = 178칸"},
  {t: "C-LOOK: 178칸", ok: false, why: "50 → 70 → 90 → 10 → 30. 20+20+80+20 = 140칸"},
  {t: "LOOK: 120칸", ok: true, why: "50 → 70 → 90 → 30 → 10. 20+20+60+20 = 120칸"}
]}
{@let mark = (o, i) => checked ? (o.ok ? "right" : picked.includes(i) ? "wrong" : "none") : picked.includes(i) ? "picked" : "none"}
<box gap={3}>
  <text weight="bold">5번 · 수행평가 계산 문제</text>
  <text>디스크 범위 0~99, 시작 위치 50, 요청 위치 10, 30, 70, 90이고 최초 진행 방향은 오른쪽이다.</text>
  <text>**총 헤드 이동 거리가 올바른 것을 모두 고르시오.** <span color="muted">되돌아가는 구간의 이동 거리도 포함한다.</span></text>
  {#each options as o, i}
    <row gap={3} align="start" padding={{y: 2}} onPress={() => { if (!checked) picked = picked.includes(i) ? picked.filter(x => x !== i) : [...picked, i] }}>
      <box size={28} radius="full" align="center" justify="center"
        bg={{right: "green", wrong: "red", picked: "accent", none: "transparent"}[mark(o, i)]}
        border={mark(o, i) === "none" ? 2 : 0}>
        {#if mark(o, i) !== "none"}
          <icon name={mark(o, i) === "wrong" ? "x" : "check"} size={16} color={mark(o, i) === "picked" ? "onAccent" : "white"}/>
        {/if}
      </box>
      <col gap={1} flex={1}>
        <text weight="medium" color={checked && !o.ok && !picked.includes(i) ? "muted" : "foreground"}>{o.t}</text>
        {#if checked}
          <text size="sm" color="muted">{o.why}</text>
        {/if}
      </col>
    </row>
  {/each}
  <row justify="between">
    <caption>{checked ? (options.every((o, i) => o.ok === picked.includes(i)) ? "정답이에요!" : "다시 확인해 봐요.") : `${picked.length}개 골랐어요`}</caption>
    <button size="sm" variant={checked ? "outline" : "primary"} disabled={!checked && !picked.length} onPress={() => { if (checked) { picked = []; checked = false } else checked = true }}>{checked ? "다시 풀기" : "채점하기"}</button>
  </row>
</box>
