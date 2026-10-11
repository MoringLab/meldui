import type { ComponentViews } from "@engine/renderer-react";
import React from "react";
export const customComponents: ComponentViews = {
  PartInspector: ({ node, children }) => (
    <aside className="studio-part">
      <h3>{node.props.title}</h3>
      <p>{node.props.detail}</p>
      {children}
    </aside>
  ),
  EquationControls: ({ node, children }) => (
    <section className="studio-equation">
      <h3>{node.props.title}</h3>
      {children}
    </section>
  ),
  ReservationCard: ({ node, runtime, surfaceId }) => (
    <section className="studio-reservation">
      <h3>{node.props.title}</h3>
      <p>{node.props.detail}</p>
      <button
        type="button"
        onClick={() => void runtime.dispatch(surfaceId, node.id, node.props.action, node.scope)}
      >
        {node.props.label}
      </button>
    </section>
  ),
};
