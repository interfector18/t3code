import { useCallback, useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import { resolveScratchProjectScopeKey } from "@t3tools/client-runtime/state/project-grouping";
import type { ResolvedHomeListOptions } from "./home-list-options";
import { toggleHomeProjectFilter } from "./home-project-filter";
import type { HomeListFilterMenuProject } from "./home-list-filter-menu";

export function useHomeProjectFilter(
  projects: ReadonlyArray<HomeListFilterMenuProject>,
  catalogProjects: Parameters<typeof resolveScratchProjectScopeKey>[1],
  options: ResolvedHomeListOptions,
  setSelectedProjectKeys: Dispatch<SetStateAction<readonly string[]>>,
) {
  const resolvedKeys = useMemo(
    () => [
      ...new Set(
        options.selectedProjectKeys.map((key) =>
          resolveScratchProjectScopeKey(key, catalogProjects, {
            sidebarProjectGroupingMode: options.projectGroupingMode,
            sidebarProjectGroupingOverrides: {},
          })!,
        ),
      ),
    ],
    [catalogProjects, options.projectGroupingMode, options.selectedProjectKeys],
  );
  // oxlint-disable-next-line t3code/react-effect-budget -- Persist migrated scope keys when an asynchronously loaded catalog resolves them.
  useEffect(() => {
    if (
      resolvedKeys.length !== options.selectedProjectKeys.length ||
      resolvedKeys.some((key, index) => key !== options.selectedProjectKeys[index])
    ) {
      setSelectedProjectKeys(resolvedKeys);
    }
  }, [options.selectedProjectKeys, resolvedKeys, setSelectedProjectKeys]);
  // Keep offline selections saved; only scopes available in this view affect its list.
  const selectedProjectKeys = useMemo(() => {
    const available = new Set(projects.map((project) => project.key));
    return resolvedKeys.filter((key) => available.has(key));
  }, [projects, resolvedKeys]);
  const onProjectChange = useCallback(
    (key: string | null) => {
      setSelectedProjectKeys((keys) => toggleHomeProjectFilter(keys, key));
    },
    [setSelectedProjectKeys],
  );
  return { selectedProjectKeys, onProjectChange };
}
