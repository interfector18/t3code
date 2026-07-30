import { describe, expect, it } from "vite-plus/test";

import { formatSessionExpiration } from "./accessSessionExpiration";

describe("formatSessionExpiration", () => {
  it("formats a finite expiration with the supplied absolute formatter", () => {
    expect(
      formatSessionExpiration("2026-07-17T12:34:56.000Z", (value) => `absolute:${value}`),
    ).toBe("absolute:2026-07-17T12:34:56.000Z");
  });

  it("labels a null expiration as never", () => {
    expect(formatSessionExpiration(null, () => "unused")).toBe("Never");
  });
});
