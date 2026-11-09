{@let stats = [
  {label: "전체 작업", value: 128, icon: "layers", color: "foreground"},
  {label: "완료 작업", value: 94, icon: "circle-check", color: "green"},
  {label: "진행 중", value: 26, icon: "loader", color: "blue"},
  {label: "남은 작업", value: 8, icon: "clock", color: "orange"}
]}
<grid columns={2} gap={2}>
  {#each stats as s}
    <box border radius="xl" padding={4} gap={2}>
      <row justify="between">
        <text size="sm" color="muted">{s.label}</text>
        <icon name={s.icon} color={s.color} size="sm"/>
      </row>
      <text size="3xl" weight="bold" tabularNums>{s.value}</text>
    </box>
  {/each}
</grid>
