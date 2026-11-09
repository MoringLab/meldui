{@state a = 10}
<box gap={3}>
  <text>값 {a}</text>
  <slider min={0} max={100} step={0.1} value={a} showValue={false} label="텍스트만"/>
</box>
