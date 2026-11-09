{@state on = {light: true, fan: false, lock: true}}
{@state temp = 23}
{@state mode = "cool"}
<box bg="#101C2B" radius="2xl" padding={4} gap={3}>
  <row justify="between">
    <col gap={0}>
      <caption color="#93A9C3">MY SMART HOME</caption>
      <title size="xl" color="white">거실 제어</title>
    </col>
    <box bg="#21354B" radius="full" padding={3}>
      <icon name="house" color="sky-300" size="lg"/>
    </box>
  </row>
  <grid columns={3} gap={2}>
    {#each [["light", "lightbulb", "조명"], ["fan", "fan", "선풍기"], ["lock", "lock", "도어락"]] as [key, icon, label]}
      <box bg={on[key] ? "#FACC15" : "#27364A"} radius="xl" padding={3} gap={3} onPress={() => on[key] = !on[key]}>
        <icon name={icon} color={on[key] ? "#422006" : "#94A3B8"}/>
        <col gap={0}>
          <text weight="semibold" color={on[key] ? "#422006" : "white"}>{label}</text>
          <caption color={on[key] ? "#713F12" : "#94A3B8"}>{on[key] ? "켜짐" : "꺼짐"}</caption>
        </col>
      </box>
    {/each}
  </grid>
  <box bg="#21354B" radius="xl" padding={4} gap={3}>
    <row justify="between">
      <text weight="semibold" color="white">에어컨</text>
      <badge tone="info">가상 제어</badge>
    </row>
    <row justify="center" gap={5}>
      <button variant="secondary" icon="minus" onPress={() => temp = Math.max(16, temp - 1)}/>
      <text size="4xl" weight="bold" color="white" tabularNums>{temp}°</text>
      <button variant="secondary" icon="plus" onPress={() => temp = Math.min(30, temp + 1)}/>
    </row>
    <segmented value={mode} options={[{label: "냉방", value: "cool"}, {label: "제습", value: "dry"}, {label: "송풍", value: "fan"}]}/>
  </box>
</box>
