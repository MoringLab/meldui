import type { ComponentViews } from "@engine/renderer-react";
import React from "react";
import "./brand.css";

/**
 * Stand-in for a host's existing design system. The engine renders these instead of its built-in
 * Button and Card when the `brand` kit is active; props and actions mean exactly the same thing.
 */
export const brandComponents: ComponentViews = {
  BrandButton: ({ node, runtime, surfaceId }) => {
    const p = node.props;
    return (
      <button
        type="button"
        className={`bds-button bds-${p.variant ?? "primary"}`}
        data-brand="button"
        data-node={node.id}
        disabled={Boolean(p.disabled)}
        onClick={() => void runtime.dispatch(surfaceId, node.id, p.action, node.scope)}
      >
        <span>{String(p.label ?? "")}</span>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            d="M3 8h9M8 4l4 4-4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    );
  },
  BrandCard: ({ node, children }) => (
    <section className="bds-card" data-brand="card">
      {node.props.title ? <h2 className="bds-card-title">{String(node.props.title)}</h2> : null}
      {children}
    </section>
  ),
};
