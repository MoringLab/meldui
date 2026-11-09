{@state a = 10}
<box gap={3}>
  <svg viewBox="0 0 300 100"><circle cx={a * 3} cy={50} r={20} fill="blue"/></svg>
  <slider min={0} max={100} step={0.1} value={a}/>
</box>
