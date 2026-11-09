<box gap={3}>
  <text>N=3이라면 요청을 **들어온 순서대로 3개씩 묶는 것**부터 시작해.</text>
  <grid columns={2} gap={2}>
    {#each [["첫 번째 묶음", "80, 20, 70", "먼저 처리"], ["두 번째 묶음", "10, 90, 30", "그다음 처리"]] as [title, values, note]}
      <box border radius="xl" padding={4} gap={1}>
        <caption>{title}</caption>
        <text size="lg" weight="bold" tabularNums>{values}</text>
        <caption>{note}</caption>
      </box>
    {/each}
  </grid>
</box>
