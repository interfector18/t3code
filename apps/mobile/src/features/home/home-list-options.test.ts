import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  derivePhysicalProjectKey,
  resolveScratchProjectScopeKey,
} from "@t3tools/client-runtime/state/project-grouping";
import { AtomRegistry } from "effect/reactivity";
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const saved = vi.hoisted(() => [] as unknown[]);
vi.mock("../../state/preferences", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    updateMobilePreferencesAtom: Atom.writable(
      () => null,
      (_ctx, patch: unknown) => {
        saved.push(patch);
      },
    ),
  };
});

import type { ThreadListFilters } from "../../persistence/mobile-preferences";
import { HomeListOptionsProvider, useHomeListOptions } from "./home-list-options";
import { useHomeProjectFilter } from "./use-home-project-filter";

describe("home list options across layout changes", () => {
  const environmentId = EnvironmentId.make("environment-1");
  const availableEnvironmentIds = new Set([environmentId]);
  let root: Root;
  let latest: ReturnType<typeof useHomeListOptions>;
  let projectFilter: ReturnType<typeof useHomeProjectFilter>;
  let availableProjects = [
    { key: "repository:one", label: "One" },
    { key: "repository:two", label: "Two" },
  ];
  let catalogProjects: Parameters<typeof useHomeProjectFilter>[1] = [];

  function ThreadList() {
    const state = useHomeListOptions(availableEnvironmentIds);
    const filter = useHomeProjectFilter(
      availableProjects,
      catalogProjects,
      state.options,
      state.setSelectedProjectKeys,
    );
    useLayoutEffect(() => {
      latest = state;
      projectFilter = filter;
    });
    return null;
  }

  const registry = AtomRegistry.make();

  async function showLayout(layout: "compact" | "sidebar", savedFilters?: ThreadListFilters) {
    await act(() => {
      root.render(
        createElement(
          RegistryContext,
          { value: registry },
          createElement(
            HomeListOptionsProvider,
            { projectGroupingMode: "repository", savedFilters },
            createElement(ThreadList, { key: layout }),
          ),
        ),
      );
    });
  }

  beforeEach(() => {
    const document = {
      nodeType: 9,
      addEventListener() {},
      removeEventListener() {},
    };
    const container = {
      nodeType: 1,
      tagName: "DIV",
      namespaceURI: "http://www.w3.org/1999/xhtml",
      ownerDocument: document,
      addEventListener() {},
      removeEventListener() {},
    };
    vi.stubGlobal("document", document);
    vi.stubGlobal("window", { document, HTMLIFrameElement: EventTarget });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    root = createRoot(container as unknown as HTMLElement);
    saved.length = 0;
    availableProjects = [
      { key: "repository:one", label: "One" },
      { key: "repository:two", label: "Two" },
    ];
    catalogProjects = [];
  });

  afterEach(async () => {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  it.each([
    ["compact", "sidebar"],
    ["sidebar", "compact"],
  ] as const)(
    "retains filters through repeated %s → %s round trips and keeps clears",
    async (initialLayout, otherLayout) => {
      await showLayout(initialLayout);

      for (const [selectedEnvironmentId, selectedProjectKey] of [
        [environmentId, "repository:one"],
        [environmentId, "repository:two"],
        [environmentId, null],
        [null, null],
        [null, "repository:one"],
      ] as const) {
        await act(() => {
          latest.setSelectedEnvironmentId(selectedEnvironmentId);
          latest.setSelectedProjectKeys(selectedProjectKey === null ? [] : [selectedProjectKey]);
        });
        for (let cycle = 0; cycle < 3; cycle += 1) {
          for (const layout of [otherLayout, initialLayout]) {
            await showLayout(layout);
            expect(latest.options).toMatchObject({
              selectedEnvironmentId,
              selectedProjectKeys: selectedProjectKey === null ? [] : [selectedProjectKey],
              projectGroupingMode: "repository",
            });
          }
        }
        await showLayout(otherLayout);
      }
    },
  );

  it("restores saved filters on launch and saves only real changes", async () => {
    await showLayout("compact", { environmentId, projectKey: "repository:one" });
    expect(latest.options).toMatchObject({
      selectedEnvironmentId: environmentId,
      selectedProjectKeys: ["repository:one"],
    });
    expect(saved).toEqual([]);

    await act(() => latest.setSelectedProjectKeys([]));
    expect(saved).toEqual([
      { threadListFilters: { environmentId, projectKey: null, projectKeys: [] } },
    ]);
  });

  it("saves multiple selections across layouts and restores them after a fresh mount", async () => {
    await showLayout("compact");
    await act(() => latest.setSelectedProjectKeys(["repository:one", "repository:two"]));
    await showLayout("sidebar");
    expect(latest.options.selectedProjectKeys).toEqual(["repository:one", "repository:two"]);
    const filters = {
      environmentId: null,
      projectKey: "repository:one",
      projectKeys: ["repository:one", "repository:two"],
    };
    expect(saved).toEqual([{ threadListFilters: filters }]);
    await act(() => root.render(null));
    saved.length = 0;
    await showLayout("compact", filters);
    expect(latest.options.selectedProjectKeys).toEqual(filters.projectKeys);
    expect(saved).toEqual([]);
    await act(() => latest.setSelectedProjectKeys([...filters.projectKeys]));
    expect(saved).toEqual([]);
  });

  it("keeps offline selections saved and toggles them consistently from either layout", async () => {
    const projectKeys = ["repository:one", "repository:two"];
    await showLayout("compact", { environmentId: null, projectKey: projectKeys[0]!, projectKeys });
    availableProjects = [availableProjects[0]!];
    await showLayout("sidebar");
    expect(projectFilter.selectedProjectKeys).toEqual(["repository:one"]);
    expect(latest.options.selectedProjectKeys).toEqual(projectKeys);
    expect(saved).toEqual([]);
    availableProjects.push({ key: "repository:two", label: "Two" });
    availableProjects = [...availableProjects];
    await showLayout("compact");
    expect(projectFilter.selectedProjectKeys).toEqual(projectKeys);
    await act(() => projectFilter.onProjectChange("repository:one"));
    await showLayout("sidebar");
    expect(projectFilter.selectedProjectKeys).toEqual(["repository:two"]);
    await act(() => projectFilter.onProjectChange(null));
    expect(latest.options.selectedProjectKeys).toEqual([]);
    expect(projectFilter.selectedProjectKeys).toEqual([]);
  });

  it("coalesces saved scratch selections when configs arrive without losing other projects", async () => {
    const first = {
      environmentId,
      id: ProjectId.make("scratch-one"),
      workspaceRoot: "/scratch/one",
      repositoryIdentity: null,
    };
    const second = { ...first, id: ProjectId.make("scratch-two"), workspaceRoot: "/scratch/two" };
    const firstKey = derivePhysicalProjectKey(first);
    const secondKey = derivePhysicalProjectKey(second);
    catalogProjects = [first, second];
    availableProjects = [
      { key: firstKey, label: "One" },
      { key: secondKey, label: "Two" },
      { key: "repository:one", label: "Repo" },
    ];
    await showLayout("compact", {
      environmentId: null,
      projectKey: firstKey,
      projectKeys: [firstKey, secondKey, "repository:one"],
    });
    catalogProjects = catalogProjects.map((project) => ({ ...project, isScratch: true as const }));
    const scratchKey = resolveScratchProjectScopeKey(firstKey, catalogProjects)!;
    availableProjects = [
      { key: scratchKey, label: "No project" },
      { key: "repository:one", label: "Repo" },
    ];
    await showLayout("sidebar");
    expect(latest.options.selectedProjectKeys).toEqual([firstKey, secondKey, "repository:one"]);
    expect(projectFilter.selectedProjectKeys).toEqual([scratchKey, "repository:one"]);
    expect(saved).toEqual([]);
    await act(() => projectFilter.onProjectChange("repository:one"));
    expect(latest.options.selectedProjectKeys).toEqual([scratchKey]);
  });
});
