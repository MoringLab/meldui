{@state hue = 220}
{@state sat = 70}
{@state light = 52}
{@state radius = 14}
{@state dark = false}
{@let swatches = [0, 24, 48, 140, 190, 220, 265, 330]}
{@let main = `hsl(${hue}, ${sat}%, ${light}%)`}
{@let soft = `hsl(${hue}, ${sat}%, ${dark ? 22 : 93}%)`}
<box gap={4}>
  <title>색상 고르기</title>
  <row gap={2} wrap>
    {#each swatches as h}
      <box size={32} radius="full" bg={`hsl(${h}, ${sat}%, ${light}%)`} border={hue === h ? {size: 2, color: "foreground"} : false} onPress={() => hue = h}/>
    {/each}
  </row>
  <slider label="색상" min={0} max={360} value={hue} color={main} unit="°"/>
  <slider label="채도" min={0} max={100} value={sat} color={main} unit="%"/>
  <slider label="밝기" min={20} max={80} value={light} color={main} unit="%"/>
  <slider label="모서리" min={0} max={28} value={radius} color={main}/>
  <switch label="어두운 화면" value={dark}/>
  <box padding={4} gap={3} radius={radius} bg={dark ? "#14161c" : "#ffffff"} border={dark ? false : true} theme={dark ? "dark" : "light"}>
    <row gap={3}>
      <box size={44} radius={radius * 0.8} bg={soft} align="center" justify="center">
        <icon name="sparkles" color={main}/>
      </box>
      <col gap={0} flex={1}>
        <text weight="semibold">미리보기 카드</text>
        <caption>고른 색이 바로 입혀져요</caption>
      </col>
    </row>
    <row gap={2}>
      <button flex={1} color={main} radius={radius}>확인</button>
      <button flex={1} variant="outline" color={main} radius={radius}>취소</button>
    </row>
  </box>
  <row justify="between">
    <text mono size="sm">{main}</text>
    <button size="sm" variant="ghost" icon="copy" onPress={() => copy(main)}>복사</button>
  </row>
</box>
