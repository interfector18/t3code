import { connectionRouteKind, connectionRoutes } from "@t3tools/client-runtime/connection";
import { Atom } from "effect/reactivity";

import { environmentCatalog } from "../connection/catalog";

export const primaryEnvironmentIdAtom = Atom.make((get) => {
  for (const [environmentId, entry] of get(environmentCatalog.catalogValueAtom).entries) {
    if (entry.target._tag === "PrimaryConnectionTarget") {
      return environmentId;
    }
  }
  return null;
}).pipe(Atom.withLabel("web-primary-environment-id"));

/**
 * The environment whose machine this client wears the themes of: the primary
 * one, or else one reached over loopback -- a desktop with its local backend
 * off that connects to a server on the same machine is still anchored there.
 */
export const themeEnvironmentIdAtom = Atom.make((get) => {
  const primary = get(primaryEnvironmentIdAtom);
  if (primary !== null) return primary;
  for (const [environmentId, entry] of get(environmentCatalog.catalogValueAtom).entries) {
    if (connectionRoutes(entry).some((route) => connectionRouteKind(route) === "loopback")) {
      return environmentId;
    }
  }
  return null;
}).pipe(Atom.withLabel("web-theme-environment-id"));
