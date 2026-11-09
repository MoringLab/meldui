<box gap={4}>
  <col gap={2}>
    <title size="2xl">대형 제목</title>
    <title>중간 제목</title>
    <text>일반 텍스트, **굵은 텍스트**, *기울임*, <u>밑줄</u>, ~~취소선~~</text>
  </col>
  <row gap={2} wrap>
    <badge>기본</badge>
    <badge tone="success">완료</badge>
    <badge tone="orange">진행 중</badge>
    <badge tone="danger">오류</badge>
    <badge tone="info">정보</badge>
  </row>
  <row gap={5}>
    {#each ["house", "settings", "bell", "heart", "search", "code-xml", "sparkles"] as name}
      <icon name={name}/>
    {/each}
  </row>
  <divider/>
  <row gap={2} wrap>
    <button>기본 버튼</button>
    <button variant="secondary">보조 버튼</button>
    <button variant="outline">외곽선</button>
  </row>
</box>
