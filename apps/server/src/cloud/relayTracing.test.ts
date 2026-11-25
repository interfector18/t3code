import { assert, it } from "@effect/vitest";
import { allowedFor } from "./relayTracing.ts";

it("never advertises relay telemetry regardless of environment or policy", () => {
  for (const env of [
    {},
    { T3CODE_TELEMETRY_ENABLED: "true" },
    { CI: "false", OTEL_SDK_DISABLED: "false" },
  ]) {
    assert.isFalse(allowedFor(env, undefined));
  }
});
