import { mkdirSync, writeFileSync } from "node:fs";
import { referenceComponents } from "../packages/kit-spec/src/reference-components.js";
import { buildCatalogSchema, componentSchemas } from "../packages/protocol/src/index.js";

const catalogId = "urn:meldui:studio:1";
const catalog = buildCatalogSchema(
  {
    ...componentSchemas,
    ...Object.fromEntries(referenceComponents.map((d) => [d.name, d.schema])),
  },
  catalogId,
);
mkdirSync("fixtures/custom", { recursive: true });
writeFileSync("fixtures/custom/catalog.json", JSON.stringify(catalog, null, 2) + "\n");
writeFileSync(
  "fixtures/custom/case.json",
  JSON.stringify(
    {
      id: "custom-kit",
      title: "커스텀 컴포넌트",
      messages: [
        { version: "v0.9", createSurface: { surfaceId: "main", catalogId } },
        {
          version: "v0.9",
          updateDataModel: {
            surfaceId: "main",
            path: "/",
            value: { selectedPart: "Fork", voltage: 12 },
          },
        },
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "main",
            components: [
              { id: "root", component: "Column", children: ["inspect", "equation", "reservation"] },
              {
                id: "inspect",
                component: "PartInspector",
                title: { path: "/selectedPart" },
                detail: "호스트가 만든 컴포넌트입니다. 입력·액션은 공통 상태를 사용합니다.",
              },
              {
                id: "equation",
                component: "EquationControls",
                title: "전압을 바꿔보세요",
                children: ["voltage"],
              },
              {
                id: "voltage",
                component: "Slider",
                label: "전압 · V",
                value: { path: "/voltage" },
                min: 1,
                max: 24,
                step: 1,
              },
              {
                id: "reservation",
                component: "ReservationCard",
                title: "예약 초안",
                detail: "저장은 호스트가 확인합니다.",
                label: "호스트에 확인 요청",
                action: {
                  event: { name: "confirmReservation", context: { voltage: { path: "/voltage" } } },
                },
              },
            ],
          },
        },
      ],
    },
    null,
    2,
  ) + "\n",
);
