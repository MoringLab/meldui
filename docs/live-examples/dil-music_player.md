
{@body const tracks = [
  {title:"Midnight Drive",artist:"Neon Waves",duration:218,color:"#8B5CF6"},
  {title:"After Hours",artist:"The Midnight Club",duration:194,color:"#EC4899"},
  {title:"Blue Horizon",artist:"Ocean Avenue",duration:242,color:"#0284C7"}
]}
{@body const [idx,setIdx] = DIL.useState(0)}
{@body const [playing,setPlaying] = DIL.useState(false)}
{@body const [progress,setProgress] = DIL.useState(36)}
{@body const [liked,setLiked] = DIL.useState(false)}
{@body const [volume,setVolume] = DIL.useState(65)}
{@body const track = tracks[idx]}
{@body const fmt = s =>
  `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`}

<box background="#101018" theme="dark" radius="3xl" padding={4} gap={4}>
  <row align="center" justify="between">
    <icon name="chevron-down" color="#FFFFFF"/>
    <col gap="2px" align="center">
      <text size="2xs" color="#A1A1AA" weight="medium">NOW PLAYING</text>
      <text color="#FFFFFF" size="sm" weight="medium">Night Sessions</text>
    </col>
    <icon name="ellipsis" color="#FFFFFF"/>
  </row>

  <box radius="2xl" clip>
    <AsyncImage
      query="aesthetic dark purple violet moon over sea surreal synthwave album cover artwork no text"
      aspectRatio="1:1"
      width="100%"
    />
  </box>

  <row align="center" justify="between">
    <col gap="3px" flex="1">
      <title size="xl" color="#FFFFFF">{track.title}</title>
      <text color="#A1A1AA" size="sm">{track.artist}</text>
    </col>
    <button color="secondary" variant="ghost" size="lg" onClick={()=>setLiked(!liked)}>
      <icon
        name="heart"
        color={liked?"#FB7185":"#A1A1AA"}
        fill={liked?"#FB7185":"none"}
        size="lg"
      />
    </button>
  </row>

  <box gap={1}>
    <slider min={0} max={100} value={progress} onChange={setProgress}/>
    <row justify="between">
      <text color="#A1A1AA" size="xs" tabularNums>
        {fmt(track.duration*progress/100)}
      </text>
      <text color="#A1A1AA" size="xs" tabularNums>
        {fmt(track.duration)}
      </text>
    </row>
  </box>

  <row align="center" justify="between" padding={{x:3}}>
    <icon name="shuffle" color="#A1A1AA"/>

    <button color="secondary" variant="ghost"
      onClick={()=>{setIdx((idx+2)%3);setProgress(0)}}>
      <icon name="skip-back" color="#FFFFFF" size="xl" fill="#FFFFFF"/>
    </button>

    <pressable background="#FFFFFF" radius="full" size="68px"
      align="center" justify="center"
      onClick={()=>setPlaying(!playing)}>
      <icon
        name={playing?"pause":"play"}
        color="#101018"
        fill="#101018"
        size="2xl"
      />
    </pressable>

    <button color="secondary" variant="ghost"
      onClick={()=>{setIdx((idx+1)%3);setProgress(0)}}>
      <icon name="skip-forward" color="#FFFFFF" size="xl" fill="#FFFFFF"/>
    </button>

    <icon name="repeat-2" color="#A1A1AA"/>
  </row>

  <row align="center" gap={3}>
    <icon name="volume-2" color="#A1A1AA"/>
    <box flex="1">
      <slider min={0} max={100} value={volume} onChange={setVolume}/>
    </box>
    <text color="#A1A1AA" size="xs" tabularNums>{volume}%</text>
  </row>

  <divider color="#30303B"/>

  <row align="center" justify="between">
    <row align="center" gap={2}>
      <icon name="list-music" color="#A1A1AA"/>
      <text color="#A1A1AA" size="xs">3 tracks in queue</text>
    </row>
    <badge color="secondary">UI DEMO</badge>
  </row>
</box>

