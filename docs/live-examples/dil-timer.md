
{@body const [minutes,setMinutes]=DIL.useState(25)}
{@body const [running,setRunning]=DIL.useState(false)}
{@body const [task,setTask]=DIL.useState("수학 문제 풀기")}
{@body const [done,setDone]=DIL.useState(2)}

<box background="#1E1B4B" theme="dark" radius="2xl" padding={4} gap={4}>
  <row align="center" justify="between">
    <row align="center" gap={2}>
      <icon name="brain" color="#C4B5FD" size="lg"/>
      <title color="#FFFFFF">Focus Room</title>
    </row>
    <badge color="secondary">DEMO</badge>
  </row>

  <box align="center" gap={3} padding={{y:3}}>
    <box border={{size:6,color:running?"#A78BFA":"#4C467E"}}
      radius="full" size="215px" align="center"
      justify="center" gap={2}>
      <icon name={running?"flame":"clock-3"}
        color="#C4B5FD" size="xl"/>
      <title color="#FFFFFF" size="2xl" tabularNums>
        {String(minutes).padStart(2,"0")}:00
      </title>
      <text color="#C4B5FD" size="xs">
        {running?"집중 중":"집중 준비"}
      </text>
    </box>
    <text color="#C4B5FD" size="xs">
      타이머는 자동으로 흐르지 않는 UI 시연용이야.
    </text>
  </box>

  <row gap={2}>
    <box flex="1">
      <button block color="primary" onClick={()=>setRunning(!running)}>
        <icon name={running?"pause":"play"} size="sm"/>
        {running?"일시정지":"집중 시작"}
      </button>
    </box>
    <button color="secondary"
      onClick={()=>{setRunning(false);setMinutes(25)}}>
      <icon name="rotate-ccw"/>
    </button>
  </row>

  <row gap={2} justify="center">
    {#each [15,25,45,60] as m}
      <pressable key={m} flex="1" align="center" padding={2}
        radius="lg"
        background={minutes===m?"#6D5CE7":"#312E68"}
        onClick={()=>{setMinutes(m);setRunning(false)}}>
        <text color="#FFFFFF" size="sm" weight="medium">{m}분</text>
      </pressable>
    {/each}
  </row>

  <divider color="#433D79"/>
  <text color="#FFFFFF" weight="medium" size="sm">이번 세션 목표</text>
  <input value={task} onChange={setTask} size="lg"/>

  <row align="center" justify="between">
    <col gap={1}>
      <text color="#C4B5FD" size="xs">오늘 완료한 세션</text>
      <title color="#FFFFFF" size="lg">{done}회</title>
    </col>
    <button color="secondary" onClick={()=>setDone(done+1)}>
      <icon name="check" size="sm"/> 세션 완료
    </button>
  </row>
</box>

