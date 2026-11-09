{@let many = Array.from({length: 300}, (_, i) => i)}
{@state w = 30}
<box gap={2}>
  <slider label="폭" min={1} max={60} value={w}/>
  <svg viewBox="0 0 300 300">
    {#each many as i}
      <circle cx={150 + Math.cos(i / 5) * i / 2} cy={150 + Math.sin(i / 5) * i / 2} r={1 + w / 30} fill={`hsl(${i + w * 3}, 70%, 55%)`}/>
    {/each}
  </svg>
  <row justify="between"><text size="3xl" weight="bold">{(123456789012 * w).toLocaleString()}원 아주 아주 아주 긴 값</text><text weight="bold">₩{(9876543210).toLocaleString()}</text></row>
  <row><text>아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주 긴 한 단어</text><icon name="heart"/></row>
  <scroll>{#each many.slice(0, 40) as i}<box width={72} height={72} bg="subtle" radius="md" align="center" justify="center"><text>{i}</text></box>{/each}</scroll>
  {#each many.slice(0, 60) as i}<row justify="between"><text>항목 {i}</text><text color="muted">{i * w}</text></row>{/each}
</box>
