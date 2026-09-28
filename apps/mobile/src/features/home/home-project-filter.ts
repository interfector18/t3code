import type { ScopedProjectRef } from "@t3tools/contracts";
import { scopedProjectKey } from "../../lib/scopedEntities";
import type { HomeProjectScope } from "./homeThreadList";

export function toggleHomeProjectFilter(
  selectedKeys: readonly string[],
  key: string | null,
): string[] {
  if (key === null) return [];
  return selectedKeys.includes(key)
    ? selectedKeys.filter((selected) => selected !== key)
    : [...selectedKeys, key];
}

/** Resolve grouped repository scopes to environment-local projects for both mobile lists. */
export function resolveHomeProjectFilter(
  scopes: ReadonlyArray<Pick<HomeProjectScope, "key" | "title" | "projectRefs">>,
  selectedKeys: readonly string[],
): { readonly projectRefs: ReadonlyArray<ScopedProjectRef> | null; readonly title: string | null } {
  if (selectedKeys.length === 0) return { projectRefs: null, title: null };
  const selected = new Set(selectedKeys);
  const matchingScopes = scopes.filter((scope) => selected.has(scope.key));
  const projectRefs = new Map<string, ScopedProjectRef>();
  for (const scope of matchingScopes) {
    for (const ref of scope.projectRefs) {
      projectRefs.set(scopedProjectKey(ref.environmentId, ref.projectId), ref);
    }
  }
  return {
    projectRefs: [...projectRefs.values()],
    title: matchingScopes.length === 1 ? matchingScopes[0]!.title : "selected projects",
  };
}
