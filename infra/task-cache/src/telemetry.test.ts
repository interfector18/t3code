import { expect, it, vi } from "vite-plus/test";
import { flushTelemetry, observeSummaries } from "./telemetry.ts";

it("never watches summaries or flushes queued reports even when enabled", async () => {
  using fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("unexpected telemetry"));
  const stop = observeSummaries(
    "/does-not-exist",
    "https://must-not-be-contacted.example",
    { T3_TASK_CACHE_TELEMETRY: "on" },
    "/does-not-exist",
  );
  stop();
  await flushTelemetry("/does-not-exist", { T3_TASK_CACHE_TELEMETRY: "on" });
  expect(fetchSpy).not.toHaveBeenCalled();
});
