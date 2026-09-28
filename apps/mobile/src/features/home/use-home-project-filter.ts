import { useCallback, useEffect, useState } from "react";
import { toggleHomeProjectFilter } from "./home-project-filter";
import type { HomeListFilterMenuProject } from "./home-list-filter-menu";

export function useHomeProjectFilter(projects: ReadonlyArray<HomeListFilterMenuProject>) {
  const [selectedProjectKeys, setSelectedProjectKeys] = useState<string[]>([]);
  useEffect(() => {
    const available = new Set(projects.map((project) => project.key));
    if (selectedProjectKeys.every((key) => available.has(key))) return;
    setSelectedProjectKeys((keys) => {
      const remaining = keys.filter((key) => available.has(key));
      return remaining.length === keys.length ? keys : remaining;
    });
  }, [projects, selectedProjectKeys]);
  const onProjectChange = useCallback((key: string | null) => {
    setSelectedProjectKeys((keys) => toggleHomeProjectFilter(keys, key));
  }, []);
  return { selectedProjectKeys, onProjectChange };
}
