{@state name = "Mori"}
{@state mode = "dev"}
{@state progress = 65}
{@state voice = true}
{@state day = "2026-11-09"}
{@let modeName = {plan: "기획", dev: "개발", test: "테스트"}[mode]}
<box gap={4}>
  <input label="프로젝트 이름" value={name}/>
  <segmented label="프로젝트 모드" value={mode} options={[{label: "기획", value: "plan"}, {label: "개발", value: "dev"}, {label: "테스트", value: "test"}]}/>
  <slider label="진행률" unit="%" min={0} max={100} value={progress}/>
  <checkbox label="실시간 음성 통화 활성화" value={voice}/>
  <date label="날짜" value={day}/>
  <box bg="surface" radius="lg" padding={4} gap={1}>
    <text weight="semibold">실시간 미리보기</text>
    <text color="muted">{name} · {modeName} · {progress}% · {voice ? "음성 통화 활성" : "음성 통화 꺼짐"}</text>
  </box>
  <button block variant="secondary" icon="copy" onPress={() => copy(`${name} · ${modeName} · ${progress}%`)}>설정 복사</button>
</box>
