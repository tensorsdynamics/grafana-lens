import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("package and plugin manifest versions", () => {
  test("stay in sync", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"),
    ) as { version: string };
    const manifest = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../openclaw.plugin.json"), "utf8"),
    ) as { version: string };

    expect(manifest.version).toBe(packageJson.version);
  });
});
