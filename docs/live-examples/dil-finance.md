
{@body const [period,setPeriod]=DIL.useState("week")}
{@body const [hidden,setHidden]=DIL.useState(false)}
{@body const dataset={
  week:[20,38,29,55,48,72,86],
  month:[30,25,43,38,62,55,90],
  year:[15,33,30,50,42,68,95]
}}
{@body const values=dataset[period]}

<box border radius="2xl" padding={4} gap={3}>
  <row align="center" justify="between">
    <row align="center" gap={2}>
      <box background="#E0E7FF" radius="lg" padding={2}>
        <icon name="wallet" color="#4338CA"/>
      </box>
      **내 자산**
    </row>
    <button size="sm" color="secondary" variant="ghost"
      onClick={()=>setHidden(!hidden)}>
      <icon name={hidden?"eye-off":"eye"}/>
    </button>
  </row>

  <col gap={1}>
    <text color="secondary" size="xs">총 보유 자산</text>
    <title size="2xl" tabularNums>
      {hidden?"••••••••":"₩ 24,850,000"}
    </title>
    <row align="center" gap={1}>
      <icon name="trending-up" color="success" size="sm"/>
      <text color="success" weight="medium" size="sm">+5.24%</text>
      <text color="secondary" size="xs">지난달 대비 (예시)</text>
    </row>
  </col>

  <segmented-control size="md" value={period} onChange={setPeriod}
    options={[
      {label:"7일",value:"week"},
      {label:"30일",value:"month"},
      {label:"1년",value:"year"}
    ]}/>

  <box height="130px" justify="end">
    <row align="end" height="100%" gap={2}>
      {#each values as v,i}
        <box key={i} flex="1" justify="end" height="100%">
          <box
            background={i===6?"#6366F1":"#C7D2FE"}
            height={`${v}%`}
            radius={{topLeft:"sm",topRight:"sm"}}
          />
        </box>
      {/each}
    </row>
  </box>

  <row justify="between">
    <text size="2xs" color="secondary">이전</text>
    <text size="2xs" color="secondary">현재</text>
  </row>
  <divider/>

  <row align="center" justify="between">
    <row align="center" gap={2}>
      <box background="surface-secondary" radius="lg" padding={2}>
        <icon name="landmark"/>
      </box>
      <col gap={1}>
        <text weight="medium" size="sm">예금 및 현금</text>
        <text size="xs" color="secondary">전체 자산의 68%</text>
      </col>
    </row>
    <text weight="medium" tabularNums>
      {hidden?"••••":"₩ 16,898,000"}
    </text>
  </row>

  <row align="center" justify="between">
    <row align="center" gap={2}>
      <box background="surface-secondary" radius="lg" padding={2}>
        <icon name="chart-no-axes-combined"/>
      </box>
      <col gap={1}>
        <text weight="medium" size="sm">투자 자산</text>
        <text size="xs" color="secondary">전체 자산의 32%</text>
      </col>
    </row>
    <text weight="medium" tabularNums>
      {hidden?"••••":"₩ 7,952,000"}
    </text>
  </row>

  <caption>모든 금액과 그래프는 시연용 가상 데이터야.</caption>
</box>

