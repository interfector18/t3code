import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { resolveHomeProjectFilter, toggleHomeProjectFilter } from "./home-project-filter";
import { buildHomeListFilterMenu } from "./home-list-filter-menu";
import { buildThreadListV2Items } from "../threads/threadListV2";
import { makeThreadShellFixture } from "../../test-fixtures";

describe("mobile project multiselect", () => {
  const local = { environmentId: EnvironmentId.make("local"), projectId: ProjectId.make("same") };
  const remote = { environmentId: EnvironmentId.make("remote"), projectId: ProjectId.make("same") };
  const other = { environmentId: EnvironmentId.make("local"), projectId: ProjectId.make("other") };
  const scopes = [
    { key: "repository", title: "Repository", projectRefs: [local, remote] },
    { key: "other", title: "Other", projectRefs: [other] },
  ];

  it("shows the union of selected projects through the menu and actual thread-list filter", () => {
    let selectedProjectKeys: string[] = [];
    const threads = [
      local,
      remote,
      other,
      {
        environmentId: EnvironmentId.make("unselected"),
        projectId: ProjectId.make("same"),
      },
    ].map((ref, index) =>
      makeThreadShellFixture({
        ...ref,
        id: ThreadId.make(`thread-${index}`),
        title: `Thread ${index}`,
      }),
    );
    const select = (label: string) => {
      const menu = buildHomeListFilterMenu({
        environments: [],
        projects: scopes.map((scope) => ({ key: scope.key, label: scope.title })),
        selectedEnvironmentId: null,
        selectedProjectKeys,
        onEnvironmentChange: () => {},
        onProjectChange: (key) => {
          selectedProjectKeys = toggleHomeProjectFilter(selectedProjectKeys, key);
        },
      });
      const projectMenu = menu.items.find(
        (item) => item.type === "submenu" && item.title === "Project",
      );
      if (projectMenu?.type !== "submenu") throw new Error("Missing project menu");
      projectMenu.items.find((item) => item.title === label)!.onPress();
    };
    const visible = (environmentId: typeof local.environmentId | null = null) =>
      buildThreadListV2Items({
        threads,
        environmentId,
        projectRefs: resolveHomeProjectFilter(scopes, selectedProjectKeys).projectRefs,
        searchQuery: "",
        now: "2026-10-03T00:00:00.000Z",
      })
        .items.map((item) => item.thread.id)
        .sort();
    select("Repository");
    expect(visible()).toEqual(["thread-0", "thread-1"]);
    select("Other");
    expect(visible()).toEqual(["thread-0", "thread-1", "thread-2"]);
    expect(visible(local.environmentId)).toEqual(["thread-0", "thread-2"]);
    select("Repository");
    expect(visible()).toEqual(["thread-2"]);
    select("All projects");
    expect(visible()).toEqual(["thread-0", "thread-1", "thread-2", "thread-3"]);
  });

  it("adds a second project without replacing the first, and deselects independently", () => {
    const first = toggleHomeProjectFilter([], "repository");
    const both = toggleHomeProjectFilter(first, "other");
    expect(resolveHomeProjectFilter(scopes, both).projectRefs).toEqual([local, remote, other]);
    expect(toggleHomeProjectFilter(both, "repository")).toEqual(["other"]);
    expect(toggleHomeProjectFilter(["other"], "other")).toEqual([]);
  });

  it("clears all filters and includes every project when none are selected", () => {
    expect(
      resolveHomeProjectFilter(scopes, toggleHomeProjectFilter(["repository", "other"], null))
        .projectRefs,
    ).toBeNull();
  });

  it("does not accidentally include all projects when a selected project disappears", () => {
    expect(resolveHomeProjectFilter(scopes, ["missing"]).projectRefs).toEqual([]);
  });

  it("deduplicates projects in overlapping scopes without mixing environments", () => {
    expect(
      resolveHomeProjectFilter(
        [...scopes, { key: "local", title: "Local", projectRefs: [local] }],
        ["repository", "local"],
      ).projectRefs,
    ).toEqual([local, remote]);
  });
});
