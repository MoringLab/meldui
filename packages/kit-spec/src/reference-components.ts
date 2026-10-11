import { componentProps, defineComponent } from "@engine/protocol";
import { z } from "zod";
/** Small reference schemas, not mandatory components. Hosts supply their own renderers. */
export const PartInspector = defineComponent({
  name: "PartInspector",
  description: "Inspect a selected mechanical part and its purpose.",
  schema: z.object({
    title: componentProps.text,
    detail: componentProps.text,
    children: componentProps.children.optional(),
  }),
  fallback: "Card",
  examples: [{ title: "Wheel", detail: "Transfers torque to the road." }],
});
export const EquationControls = defineComponent({
  name: "EquationControls",
  description: "Group labeled variables that update a linked equation and visualization.",
  schema: z.object({ title: componentProps.text, children: componentProps.children }),
  fallback: "Column",
  examples: [{ title: "Variables", children: [] }],
});
export const ReservationCard = defineComponent({
  name: "ReservationCard",
  description: "Present a host-verified reservation draft and an explicit confirmation action.",
  schema: z.object({
    title: componentProps.text,
    detail: componentProps.text,
    label: componentProps.text,
    action: componentProps.action,
  }),
  fallback: "Confirmation",
  examples: [
    {
      title: "Reservation draft",
      detail: "Not yet saved",
      label: "Confirm",
      action: { event: { name: "confirmReservation" } },
    },
  ],
});
export const referenceComponents = [PartInspector, EquationControls, ReservationCard];
