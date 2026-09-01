import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import _Ajv from "ajv";
// AJV is CJS — under NodeNext, default export wraps the module namespace
const Ajv = _Ajv.default;
import { afterEach, describe, expect, test } from "vitest";
import { parseConfig, parseOtlpHeadersEnv, validateConfig } from "./config.js";

describe("parseConfig — legacy single instance", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  test("valid config normalizes to default instance with correct defaults", () => {
    const config = parseConfig({
      grafana: {
        url: "http://localhost:3000",
        apiKey: "glsa_test",
      },
    });

    // Normalized to instances map
    expect(config.grafana.defaultInstance).toBe("default");
    expect(config.grafana.instances["default"]).toBeDefined();
    expect(config.grafana.instances["default"].url).toBe("http://localhost:3000");
    expect(config.grafana.instances["default"].apiKey).toBe("glsa_test");
    expect(config.grafana.instances["default"].orgId).toBe(1);
    expect(config.metrics?.enabled).toBe(true);
    expect(config.otlp?.endpoint).toBeUndefined();
    expect(config.proactive?.enabled).toBe(false);
    expect(config.proactive?.costAlertThreshold).toBe(5.0);
  });

  test("missing grafana url and apiKey does NOT throw — returns partial config", () => {
    const config = parseConfig({});
    expect(config.grafana.instances["default"].url).toBeUndefined();
    expect(config.grafana.instances["default"].apiKey).toBeUndefined();
  });

  test("env var fallback works when config values missing", () => {
    process.env = {
      ...originalEnv,
      GRAFANA_URL: "http://env-grafana:3000",
      GRAFANA_SERVICE_ACCOUNT_TOKEN: "glsa_env_token",
    };

    const config = parseConfig({});

    expect(config.grafana.instances["default"].url).toBe("http://env-grafana:3000");
    expect(config.grafana.instances["default"].apiKey).toBe("glsa_env_token");
  });

  test("URL trailing slash stripped", () => {
    const config = parseConfig({
      grafana: {
        url: "http://localhost:3000///",
        apiKey: "glsa_test",
      },
    });

    expect(config.grafana.instances["default"].url).toBe("http://localhost:3000");
  });

  test("always produces exactly one instance named 'default'", () => {
    const config = parseConfig({ grafana: { url: "http://g:3000", apiKey: "k" } });
    expect(Object.keys(config.grafana.instances)).toEqual(["default"]);
    expect(config.grafana.defaultInstance).toBe("default");
  });
});

describe("parseConfig — multi-instance", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  test("parses array of named instances", () => {
    const config = parseConfig({
      grafana: {
        instances: [
          { name: "dev", url: "http://dev:3000", apiKey: "key_dev", orgId: 2 },
          { name: "prd", url: "http://prd:3000", apiKey: "key_prd" },
        ],
        default: "dev",
      },
    });

    expect(config.grafana.defaultInstance).toBe("dev");
    expect(Object.keys(config.grafana.instances)).toEqual(["dev", "prd"]);
    expect(config.grafana.instances["dev"].url).toBe("http://dev:3000");
    expect(config.grafana.instances["dev"].apiKey).toBe("key_dev");
    expect(config.grafana.instances["dev"].orgId).toBe(2);
    expect(config.grafana.instances["prd"].url).toBe("http://prd:3000");
    expect(config.grafana.instances["prd"].apiKey).toBe("key_prd");
    expect(config.grafana.instances["prd"].orgId).toBe(1); // default
  });

  test("default falls back to first entry when not specified", () => {
    const config = parseConfig({
      grafana: {
        instances: [
          { name: "staging", url: "http://stg:3000", apiKey: "key_stg" },
          { name: "prod", url: "http://prod:3000", apiKey: "key_prod" },
        ],
      },
    });

    expect(config.grafana.defaultInstance).toBe("staging");
  });

  test("env var fallback applies only to default instance", () => {
    process.env = {
      ...originalEnv,
      GRAFANA_URL: "http://env:3000",
      GRAFANA_SERVICE_ACCOUNT_TOKEN: "glsa_env",
    };

    const config = parseConfig({
      grafana: {
        instances: [
          { name: "dev" }, // no url/apiKey — should get env fallback
          { name: "prd" }, // no url/apiKey — should NOT get env fallback
        ],
        default: "dev",
      },
    });

    expect(config.grafana.instances["dev"].url).toBe("http://env:3000");
    expect(config.grafana.instances["dev"].apiKey).toBe("glsa_env");
    expect(config.grafana.instances["prd"].url).toBeUndefined();
    expect(config.grafana.instances["prd"].apiKey).toBeUndefined();
  });

  test("entries without name are skipped", () => {
    const config = parseConfig({
      grafana: {
        instances: [
          { name: "dev", url: "http://dev:3000", apiKey: "key_dev" },
          { url: "http://noname:3000", apiKey: "key_noname" }, // no name → skipped
        ],
      },
    });

    expect(Object.keys(config.grafana.instances)).toEqual(["dev"]);
  });

  test("URL trailing slashes stripped for all instances", () => {
    const config = parseConfig({
      grafana: {
        instances: [
          { name: "a", url: "http://a:3000///", apiKey: "k" },
          { name: "b", url: "http://b:3000/", apiKey: "k" },
        ],
      },
    });

    expect(config.grafana.instances["a"].url).toBe("http://a:3000");
    expect(config.grafana.instances["b"].url).toBe("http://b:3000");
  });
});

describe("validateConfig", () => {
  test("returns valid for complete legacy config", () => {
    const config = parseConfig({
      grafana: { url: "http://localhost:3000", apiKey: "glsa_test" },
    });
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.config.grafana.defaultInstance).toBe("default");
      expect(result.config.grafana.instances["default"].url).toBe("http://localhost:3000");
    }
  });

  test("returns errors for missing url and apiKey", () => {
    const config = parseConfig({});
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toContain("grafana.url");
      expect(result.errors[1]).toContain("grafana.apiKey");
    }
  });

  test("returns error for missing apiKey only", () => {
    const config = parseConfig({ grafana: { url: "http://localhost:3000" } });
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("grafana.apiKey");
    }
  });

  test("multi-instance: valid when default instance has credentials", () => {
    const config = parseConfig({
      grafana: {
        instances: [
          { name: "dev", url: "http://dev:3000", apiKey: "key_dev" },
          { name: "prd", url: "http://prd:3000", apiKey: "key_prd" },
        ],
        default: "dev",
      },
    });
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(Object.keys(result.config.grafana.instances)).toEqual(["dev", "prd"]);
    }
  });

  test("multi-instance: filters out instances with missing credentials", () => {
    const config = parseConfig({
      grafana: {
        instances: [
          { name: "dev", url: "http://dev:3000", apiKey: "key_dev" },
          { name: "incomplete", url: "http://inc:3000" }, // no apiKey
        ],
        default: "dev",
      },
    });
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    if (result.valid) {
      // Only fully-valid instances are included
      expect(Object.keys(result.config.grafana.instances)).toEqual(["dev"]);
      expect(result.config.grafana.instances["incomplete"]).toBeUndefined();
    }
  });

  test("multi-instance: invalid when default instance lacks credentials", () => {
    const config = parseConfig({
      grafana: {
        instances: [
          { name: "dev" }, // no url or apiKey
          { name: "prd", url: "http://prd:3000", apiKey: "key_prd" },
        ],
        default: "dev",
      },
    });
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("grafana.url");
    }
  });
});

describe("manifest schema", () => {
  const manifest = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../openclaw.plugin.json"), "utf-8"),
  );
  const ajv = new Ajv();
  const validate = ajv.compile(manifest.configSchema);

  test("empty config passes (fresh install)", () => {
    expect(validate({})).toBe(true);
  });

  test("legacy single-instance config passes", () => {
    expect(validate({ grafana: { url: "http://localhost:3000" } })).toBe(true);
  });

  test("full legacy config passes", () => {
    const full = {
      grafana: { url: "http://localhost:3000", apiKey: "glsa_test", orgId: 1 },
      metrics: { enabled: true },
      otlp: { endpoint: "http://localhost:4318/v1/metrics", exportIntervalMs: 15000 },
      proactive: { enabled: false, webhookPath: "/grafana-lens/alerts", costAlertThreshold: 5.0 },
      customMetrics: { enabled: true, maxMetrics: 100, maxLabelsPerMetric: 5, maxLabelValues: 50, defaultTtlDays: 30 },
    };
    expect(validate(full)).toBe(true);
  });

  test("multi-instance config passes", () => {
    expect(validate({
      grafana: {
        instances: [
          { name: "dev", url: "http://dev:3000", apiKey: "key_dev" },
          { name: "prd", url: "http://prd:3000", apiKey: "key_prd" },
        ],
        default: "dev",
      },
    })).toBe(true);
  });

  test("multi-instance without explicit default passes", () => {
    expect(validate({
      grafana: {
        instances: [
          { name: "dev", url: "http://dev:3000", apiKey: "key_dev" },
        ],
      },
    })).toBe(true);
  });

  test("otlp.instanceId passes schema validation", () => {
    expect(validate({
      otlp: { instanceId: "bot-alice" },
    })).toBe(true);
  });

  test("typo at top level rejected (grfana)", () => {
    expect(validate({ grfana: { url: "http://localhost:3000" } })).toBe(false);
    expect(validate.errors?.[0]?.keyword).toBe("additionalProperties");
  });

  test("SecretRef is accepted for legacy apiKey", () => {
    expect(validate({
      grafana: {
        url: "http://localhost:3000",
        apiKey: { source: "env", provider: "default", id: "GRAFANA_API_KEY" },
      },
    })).toBe(true);
  });

  test("SecretRef is accepted for all three named instances", () => {
    expect(validate({
      grafana: {
        instances: [
          { name: "monitoring", url: "http://monitoring:3000", apiKey: { source: "env", provider: "default", id: "FIXTURE_MONITORING_KEY" } },
          { name: "xvision", url: "http://xvision:3000", apiKey: { source: "env", provider: "default", id: "GRAFANA_XVISION_KEY" } },
          { name: "xvision2", url: "http://xvision2:3000", apiKey: { source: "env", provider: "default", id: "FIXTURE_XVISION2_KEY" } },
        ],
        default: "monitoring",
      },
    })).toBe(true);
  });

  test("unresolved SecretRef is rejected before client registration", () => {
    const config = parseConfig({
      grafana: {
        url: "http://localhost:3000",
        apiKey: { source: "env", provider: "default", id: "GRAFANA_MISSING_KEY" },
      },
    });
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual([
        "grafana.apiKey SecretRef could not be resolved before plugin activation.",
      ]);
      expect(result.errors.join(" ")).not.toContain("GRAFANA_MISSING_KEY");
    }
  });

  test.each(["monitoring", "xvision", "xvision2"])(
    "unresolved SecretRef for named instance %s is rejected before client registration",
    (defaultInstance) => {
      const config = parseConfig({
        grafana: {
          instances: [
            { name: "monitoring", url: "http://monitoring:3000", apiKey: "fixture-monitoring" },
            { name: "xvision", url: "http://xvision:3000", apiKey: "fixture-xvision" },
            { name: "xvision2", url: "http://xvision2:3000", apiKey: "fixture-xvision2" },
          ].map((instance) => instance.name === defaultInstance
            ? { ...instance, apiKey: { source: "env" as const, provider: "default", id: "FIXTURE_MISSING_KEY" } }
            : instance),
          default: defaultInstance,
        },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toEqual([
          `grafana.instances.${defaultInstance}.apiKey SecretRef could not be resolved before plugin activation.`,
        ]);
        expect(result.errors.join(" ")).not.toContain("FIXTURE_MISSING_KEY");
      }
    },
  );

  test("wrong types rejected (url: 123 in legacy)", () => {
    expect(validate({ grafana: { url: 123 } })).toBe(false);
  });

  test("declares both legacy and named SecretRef paths for OpenClaw runtime materialization", () => {
    expect(manifest.configContracts?.secretInputs?.paths).toEqual([
      { path: "grafana.apiKey", expected: "string" },
      { path: "grafana.instances.*.apiKey", expected: "string" },
    ]);
  });
});

describe("OpenClaw SecretRef contract integration", () => {
  type ContractPath = { path: string; expected?: "string" };
  type ManifestModule = {
    loadPluginManifest?: (rootDir: string) => { ok: boolean; manifest?: { configContracts?: { secretInputs?: { paths: ContractPath[] } } }; error?: string };
    i?: ManifestModule["loadPluginManifest"];
  };
  type MatcherModule = {
    collectPluginConfigContractMatches?: (params: { root: Record<string, unknown>; pathPattern: string }) => Array<{ path: string; value: unknown }>;
    t?: MatcherModule["collectPluginConfigContractMatches"];
  };

  async function loadOpenClawInternal<T>(prefix: string): Promise<T> {
    const openClawDist = dirname(createRequire(import.meta.url).resolve("openclaw"));
    const moduleName = readdirSync(openClawDist).find(
      (entry) => entry.startsWith(prefix) && entry.endsWith(".js"),
    );
    if (!moduleName) throw new Error(`OpenClaw helper ${prefix}*.js was not found`);
    return (await import(pathToFileURL(resolve(openClawDist, moduleName)).href)) as T;
  }

  test("OpenClaw manifest loader and contract matcher discover full plugin paths", async () => {
    const manifestModule = await loadOpenClawInternal<ManifestModule>("manifest-");
    const loadPluginManifest = manifestModule.loadPluginManifest ?? manifestModule.i;
    expect(loadPluginManifest).toBeTypeOf("function");
    const loaded = loadPluginManifest!(resolve(import.meta.dirname, ".."));
    expect(loaded.ok, loaded.error).toBe(true);
    const paths = loaded.manifest?.configContracts?.secretInputs?.paths;
    expect(paths).toEqual([
      { path: "grafana.apiKey", expected: "string" },
      { path: "grafana.instances.*.apiKey", expected: "string" },
    ]);

    const matcherModule = await loadOpenClawInternal<MatcherModule>("config-contract-matches-");
    const collectMatches = matcherModule.collectPluginConfigContractMatches ?? matcherModule.t;
    expect(collectMatches).toBeTypeOf("function");
    const fullConfig = {
      plugins: {
        entries: {
          "openclaw-grafana-lens": {
            config: {
              grafana: {
                url: "http://fixture-monitoring:3000",
                apiKey: { source: "env", provider: "fixture", id: "FIXTURE_LEGACY_KEY" },
                instances: [
                  { name: "monitoring", url: "http://fixture-monitoring:3000", apiKey: { source: "env", provider: "fixture", id: "FIXTURE_MONITORING_KEY" } },
                  { name: "xvision", url: "http://fixture-xvision:3000", apiKey: { source: "env", provider: "fixture", id: "FIXTURE_XVISION_KEY" } },
                  { name: "xvision2", url: "http://fixture-xvision2:3000", apiKey: { source: "env", provider: "fixture", id: "FIXTURE_XVISION2_KEY" } },
                ],
                default: "monitoring",
              },
            },
          },
        },
      },
    };
    const pluginConfig = fullConfig.plugins.entries["openclaw-grafana-lens"].config;
    const discovered = paths!.flatMap(({ path }) =>
      collectMatches!({ root: pluginConfig, pathPattern: path }).map((match) => ({
        path: `plugins.entries.openclaw-grafana-lens.config.${match.path}`,
        value: match.value,
      })),
    );
    expect(discovered.map(({ path }) => path)).toEqual([
      "plugins.entries.openclaw-grafana-lens.config.grafana.apiKey",
      "plugins.entries.openclaw-grafana-lens.config.grafana.instances[0].apiKey",
      "plugins.entries.openclaw-grafana-lens.config.grafana.instances[1].apiKey",
      "plugins.entries.openclaw-grafana-lens.config.grafana.instances[2].apiKey",
    ]);
    expect(discovered.every(({ value }) => typeof value === "object")).toBe(true);
    expect(discovered.map(({ value }) => (value as { id: string }).id)).toEqual([
      "FIXTURE_LEGACY_KEY",
      "FIXTURE_MONITORING_KEY",
      "FIXTURE_XVISION_KEY",
      "FIXTURE_XVISION2_KEY",
    ]);

    // The old root-relative paths must not match this complete plugin config.
    expect(collectMatches!({ root: pluginConfig, pathPattern: "apiKey" })).toEqual([]);
    expect(collectMatches!({ root: pluginConfig, pathPattern: "instances.*.apiKey" })).toEqual([]);
  });
});

describe("parseConfig — otlp.instanceId", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  test("auto-generates instanceId from hostname when no config or env var", () => {
    const config = parseConfig({});
    expect(config.otlp?.instanceId).toBeTruthy();
    expect(typeof config.otlp?.instanceId).toBe("string");
    expect(config.otlp?.instanceId!.length).toBeGreaterThan(0);
  });

  test("explicit config takes precedence over env var", () => {
    process.env = { ...originalEnv, OTEL_SERVICE_INSTANCE_ID: "from-env" };
    const config = parseConfig({ otlp: { instanceId: "from-config" } });
    expect(config.otlp?.instanceId).toBe("from-config");
  });

  test("OTEL_SERVICE_INSTANCE_ID env var used when no explicit config", () => {
    process.env = { ...originalEnv, OTEL_SERVICE_INSTANCE_ID: "from-env" };
    const config = parseConfig({});
    expect(config.otlp?.instanceId).toBe("from-env");
  });

  test("instanceId is always a non-empty string", () => {
    // Even with no config and no env var, hostname fallback should produce something
    const config = parseConfig({});
    expect(config.otlp?.instanceId).toBeTruthy();
  });
});

describe("parseOtlpHeadersEnv", () => {
  test("parses valid key=value pairs", () => {
    const result = parseOtlpHeadersEnv("key1=val1,key2=val2");
    expect(result.headers).toEqual({ key1: "val1", key2: "val2" });
    expect(result.skipped).toBe(0);
  });

  test("reports skipped malformed pairs without '=' separator", () => {
    const result = parseOtlpHeadersEnv("bad,key=val");
    expect(result.headers).toEqual({ key: "val" });
    expect(result.skipped).toBe(1);
  });

  test("handles empty string", () => {
    const result = parseOtlpHeadersEnv("");
    expect(result.headers).toEqual({});
    expect(result.skipped).toBe(0);
  });

  test("trims whitespace around keys and values", () => {
    const result = parseOtlpHeadersEnv("  key = value , key2=value2  ");
    expect(result.headers).toEqual({ key: "value", key2: "value2" });
    expect(result.skipped).toBe(0);
  });

  test("skips empty segments from trailing commas", () => {
    const result = parseOtlpHeadersEnv("key=val,,");
    expect(result.headers).toEqual({ key: "val" });
    expect(result.skipped).toBe(0);
  });
});

describe("parseConfig _warnings", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  test("returns warning when OTEL_EXPORTER_OTLP_HEADERS has malformed pairs", () => {
    process.env = {
      ...originalEnv,
      OTEL_EXPORTER_OTLP_HEADERS: "bad-pair,good=value",
    };
    const config = parseConfig({});
    expect(config._warnings).toBeDefined();
    expect(config._warnings!.length).toBe(1);
    expect(config._warnings![0]).toContain("malformed");
    expect(config.otlp?.headers).toEqual({ good: "value" });
  });

  test("no warnings when headers are well-formed", () => {
    process.env = {
      ...originalEnv,
      OTEL_EXPORTER_OTLP_HEADERS: "key=val",
    };
    const config = parseConfig({});
    expect(config._warnings).toBeUndefined();
  });
});
