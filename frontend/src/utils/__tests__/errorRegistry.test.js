import { describe, expect, it } from "vitest";

import { getErrorMessage } from "../errorRegistry.js";

describe("getErrorMessage", () => {
  it("interpolates repeated template placeholders", () => {
    expect(getErrorMessage("VAL_002_0004", "en", { min_words: 60 })).toBe(
      "At least 60 words are required."
    );
  });
});
