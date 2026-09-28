import type { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import type { WorkspaceEnvironment } from "../../state/workspaceModel";
import { buildHomeListFilterMenuItems, homeListFilterEnvironments } from "./home-list-filter-menu";

function environment(
  environmentId: string,
  environmentLabel: string,
  isEnabled: boolean,
): WorkspaceEnvironment {
  return {
    environmentId: environmentId as EnvironmentId,
    environmentLabel,
    displayUrl: "",
    isRelayManaged: false,
    isEnabled,
    connectionState: isEnabled ? "connected" : "available",
    connectionError: null,
    connectionErrorTraceId: null,
  };
}

it("offers only switched-on environments, sorted by label", () => {
  expect(
    homeListFilterEnvironments([
      environment("env-studio", "Studio", true),
      environment("env-laptop", "Laptop", false),
      environment("env-desk", "Desk", true),
    ]),
  ).toEqual([
    { environmentId: "env-desk", label: "Desk", connectionState: "connected" },
    { environmentId: "env-studio", label: "Studio", connectionState: "connected" },
  ]);
});

describe("buildHomeListFilterMenuItems", () => {
  it("adds a project scope submenu that selects and clears the same scope as the chips", () => {
    const onProjectChange = vi.fn();
    const menu = buildHomeListFilterMenuItems({
      environments: [],
      projects: [
        { key: "environment-1:project-1", label: "Codething" },
        { key: "environment-1:project-2", label: "Website" },
      ],
      selectedEnvironmentId: null,
      selectedProjectKeys: ["environment-1:project-1"],
      onEnvironmentChange: vi.fn(),
      onProjectChange,
    });

    const projectMenu = menu.find((item) => item.id === "project");
    expect(menu.some((item) => item.title === "Settings")).toBe(false);
    expect(projectMenu).toMatchObject({
      items: [
        { title: "All projects", selected: false },
        { title: "Codething", selected: true },
        { title: "Website", selected: false },
      ],
    });
    if (!projectMenu || !("items" in projectMenu)) throw new Error("Expected project submenu");

    const clear = projectMenu.items[0];
    const select = projectMenu.items[2];
    if (!clear || !("onPress" in clear) || !select || !("onPress" in select)) {
      throw new Error("Expected project actions");
    }
    clear.onPress();
    select.onPress();
    expect(onProjectChange).toHaveBeenNthCalledWith(1, null);
    expect(onProjectChange).toHaveBeenNthCalledWith(2, "environment-1:project-2");
  });
});
