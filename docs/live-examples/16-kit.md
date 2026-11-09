{@state metric = "매출"}
{@let rows = [{m: "1월", 매출: 120, 비용: 80}, {m: "2월", 매출: 150, 비용: 95}, {m: "3월", 매출: 132, 비용: 90}, {m: "4월", 매출: 180, 비용: 110}]}
<box gap={4}>
  <segmented value={metric} options={["매출", "비용"]}/>
  <Chart title={`월별 ${metric}`} kind="bar" values={rows.map(r => ({x: r.m, y: r[metric]}))} xKey="x" yKey="y" yUnit="만원"/>
  <Table caption="한눈에 보기" columns={[{key: "m", label: "월"}, {key: "매출", label: "매출"}, {key: "비용", label: "비용"}]} rows={rows}/>
  <Callout tone="tip" title="팁">합계는 {rows.reduce((s, r) => s + r[metric], 0).toLocaleString()}만원이에요.</Callout>
  <Calendar month="2026-11" events={[{date: "2026-11-12", title: "발표", time: "14:00", color: "blue"}, {date: "2026-11-20", title: "마감", color: "red"}]}/>
  <Diagram kind="flow"><Node id="a" label="기획"/><Node id="b" label="개발"/><Node id="c" label="배포"/><Edge from="a" to="b"/><Edge from="b" to="c"/></Diagram>
  <Formula latex="E = mc^2" meaning="에너지와 질량의 관계"/>
</box>
