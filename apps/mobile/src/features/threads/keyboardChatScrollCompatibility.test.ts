import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeVM from "node:vm";

import { describe, expect, it } from "vite-plus/test";

const require = NodeModule.createRequire(import.meta.url);
const packageRoot = NodePath.dirname(
  require.resolve("react-native-keyboard-controller/package.json"),
);

// Run the shipped hook with the UI-runtime ref shape introduced in Reanimated 4.7.
// Padding growth on thread mount schedules this callback on the next native frame.
function growComposerPadding(scrollViewRef: { value: object | null }) {
  const frames: Array<() => void> = [];
  const scrolls: Array<{ y: number; animated: boolean }> = [];
  const reanimated = {
    useAnimatedReaction: (
      prepare: () => number,
      reaction: (current: number, previous: number) => void,
    ) => reaction(prepare(), 0),
    scrollTo: (_ref: unknown, _x: number, y: number, animated: boolean) => {
      scrolls.push({ y, animated });
    },
  };

  function loadModule(file: string) {
    const exports = {};
    const module = { exports };
    NodeVM.runInNewContext(NodeFS.readFileSync(file, "utf8"), {
      exports,
      module,
      requestAnimationFrame: (callback: () => void) => frames.push(callback),
      require: (specifier: string): unknown => {
        if (specifier === "react") return { useCallback: (callback: unknown) => callback };
        if (specifier === "react-native") return { Platform: { OS: "android" } };
        if (specifier === "react-native-reanimated") return reanimated;
        if (specifier.endsWith("/architecture")) return { IS_FABRIC: true };
        if (specifier.startsWith(".")) {
          return loadModule(NodePath.resolve(NodePath.dirname(file), `${specifier}.js`));
        }
        throw new Error(`Unexpected hook dependency: ${specifier}`);
      },
    });
    return module.exports;
  }

  const hook = loadModule(
    NodePath.join(
      packageRoot,
      "lib/commonjs/components/KeyboardChatScrollView/useExtraContentPadding/index.js",
    ),
  ) as { useExtraContentPadding: (options: Record<string, unknown>) => void };
  hook.useExtraContentPadding({
    scrollViewRef,
    extraContentPadding: { value: 20 },
    keyboardPadding: { value: 0 },
    blankSpace: { value: 0 },
    adjustedInsetCompensation: 0,
    adjustedStartInsetCompensation: 0,
    scroll: { value: 500 },
    layout: { value: { width: 400, height: 500 } },
    size: { value: { width: 400, height: 1000 } },
    inverted: false,
    keyboardLiftBehavior: "persistent",
    freeze: { value: false },
  });
  return {
    flushFrame: () => frames.forEach((callback) => callback()),
    scrolls,
  };
}

describe("Android chat padding with Reanimated UI refs", () => {
  it("keeps the feed at the end when the composer grows without calling the ref object", () => {
    const harness = growComposerPadding({ value: {} });
    expect(harness.scrolls).toEqual([]);
    harness.flushFrame();
    expect(harness.scrolls).toEqual([{ y: 520, animated: false }]);
  });

  it("does not scroll a view that unmounted before the queued frame", () => {
    const ref: { value: object | null } = { value: {} };
    const harness = growComposerPadding(ref);
    ref.value = null;
    harness.flushFrame();
    expect(harness.scrolls).toEqual([]);
  });
});
