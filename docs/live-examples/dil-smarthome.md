
{@body const [lights,setLights]=DIL.useState(true)}
{@body const [temp,setTemp]=DIL.useState(23)}
{@body const [mode,setMode]=DIL.useState("cool")}
{@body const [brightness,setBrightness]=DIL.useState(75)}

<box background="#101C2B" theme="dark" radius="2xl" padding={4} gap={3}>
  <row justify="between" align="center">
    <col gap={1}>
      <text color="#93A9C3" size="xs">MY SMART HOME</text>
      <title color="#FFFFFF" size="xl">거실 제어</title>
    </col>
    <box background="#21354B" radius="full" padding={3}>
      <icon name="house" color="#7DD3FC" size="lg"/>
    </box>
  </row>

  <grid columns={2} gap={2}>
    <grid-item>
      <pressable
        background={lights?"#FACC15":"#27364A"}
        theme={lights?"light":"dark"}
        radius="xl" padding={3} gap={3}
        onClick={()=>setLights(!lights)}
      >
        <row justify="between" align="center">
          <icon name="lightbulb" size="lg" color={lights?"#422006":"#94A3B8"}/>
          <icon name="power" color={lights?"#422006":"#94A3B8"}/>
        </row>
        <col gap={1}>
          <text color={lights?"#422006":"#FFFFFF"} weight="medium">조명</text>
          <text color={lights?"#713F12":"#94A3B8"} size="xs">
            {lights?"켜짐":"꺼짐"}
          </text>
        </col>
      </pressable>
    </grid-item>

    <grid-item>
      <box background="#27364A" radius="xl" padding={3} gap={3}>
        <icon name="thermometer" color="#7DD3FC" size="lg"/>
        <col gap={1}>
          <text color="#FFFFFF" weight="medium">실내 온도</text>
          <text color="#94A3B8" size="xs">22.5°C (예시)</text>
        </col>
      </box>
    </grid-item>
  </grid>

  <box background="#21354B" radius="xl" padding={3} gap={3}>
    <row justify="between" align="center">
      <text color="#FFFFFF" weight="medium">에어컨 설정</text>
      <badge color="info">가상 제어</badge>
    </row>

    <row align="center" justify="center" gap={4}>
      <pressable background="#33475D" radius="full" padding={3}
        onClick={()=>setTemp(Math.max(16,temp-1))}>
        <icon name="minus" color="#FFFFFF"/>
      </pressable>
      <col align="center" gap={1}>
        <title color="#FFFFFF" size="2xl" tabularNums>{temp}°C</title>
        <text color="#93A9C3" size="xs">희망 온도</text>
      </col>
      <pressable background="#33475D" radius="full" padding={3}
        onClick={()=>setTemp(Math.min(30,temp+1))}>
        <icon name="plus" color="#FFFFFF"/>
      </pressable>
    </row>

    <segmented-control size="md" value={mode} onChange={setMode}
      options={[
        {label:"냉방",value:"cool"},
        {label:"난방",value:"heat"},
        {label:"송풍",value:"fan"}
      ]}/>
  </box>

  <row align="center" justify="between">
    <text color="#CBD5E1" size="sm">조명 밝기</text>
    <text color="#FFFFFF" size="sm" tabularNums>{brightness}%</text>
  </row>
  <slider min={0} max={100} value={brightness}
    onChange={setBrightness} disabled={!lights}/>
</box>

