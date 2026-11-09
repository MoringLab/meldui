{@state tab = "overview"}
{@state tasks = [{t: "디자인 시안", done: true}, {t: "API 연결", done: false}, {t: "출시 전 테스트", done: false}]}
{@state alerts = true}
{@let doneCount = tasks.filter(x => x.done).length}
<box gap={4}>
  <segmented value={tab} options={[{label: "개요", value: "overview"}, {label: "작업", value: "tasks"}, {label: "설정", value: "settings"}]}/>
  {#if tab === "overview"}
    <col gap={1}>
      <title size="xl">Mori 프로젝트</title>
      <text color="muted">예시 프로젝트 대시보드입니다.</text>
    </col>
    <row justify="between">
      <text>완료된 작업</text>
      <text weight="bold" tabularNums>{doneCount} / {tasks.length}</text>
    </row>
    <progress value={doneCount} max={tasks.length} color="green"/>
  {:else if tab === "tasks"}
    <col gap={0}>
      {#each tasks as task}
        <checkbox value={task.done} label={task.t}/>
      {/each}
    </col>
  {:else}
    <switch label="작업 알림 받기" value={alerts}/>
    <caption>{alerts ? "작업이 끝나면 알려 드려요." : "알림이 꺼져 있어요."}</caption>
  {/if}
</box>
