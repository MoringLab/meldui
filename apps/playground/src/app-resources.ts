import type { AppResource } from "@engine/renderer-react";
/** The host resolves only its fixed version registry; no model URL becomes a request. */
export async function loadAppResources(ids: string[], signal: AbortSignal): Promise<AppResource[]> {
  return Promise.all(
    [...new Set(ids)].map(async (id) => {
      if (!["three", "d3", "chart", "katex", "gsap"].includes(id)) throw Error("RESOURCE_DENIED");
      const response = await fetch(`/api/resources/${id}`, { signal });
      if (!response.ok) throw Error("RESOURCE_UNAVAILABLE");
      return response.json();
    }),
  );
}
