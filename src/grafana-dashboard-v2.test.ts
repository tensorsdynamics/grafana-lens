import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GrafanaClient } from "./grafana-client.js";
import type { DashboardV2Resource } from "./grafana-dashboard-v2-types.js";

function makeDashboardV2Resource(overrides?: Partial<DashboardV2Resource>): DashboardV2Resource {
  const { metadata, spec, ...rest } = overrides ?? {};
  return {
    apiVersion: "dashboard.grafana.app/v2beta1",
    kind: "Dashboard",
    metadata: {
      name: "operations/dashboard",
      resourceVersion: "rv-opaque-42",
      ...(metadata ?? {}),
    },
    spec: {
      title: "Operations",
      layout: { kind: "TabsLayout", spec: { tabs: [] } },
      futureGrafanaField: { enabled: true, values: ["kept", 7] },
      ...(spec ?? {}),
    },
    status: { phase: "Ready" },
    ...rest,
  };
}

describe("Grafana Dashboard API V2 read contract", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("GETs a namespaced resource with encoded path segments and preserves opaque spec fields", async () => {
    const fixture = makeDashboardV2Resource();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(fixture),
    });

    const client = new GrafanaClient({
      url: "http://localhost:3000",
      apiKey: "test-key",
    });
    const result = await client.getDashboardV2("team/platform", "operations/dashboard");

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "http://localhost:3000/apis/dashboard.grafana.app/v2beta1/namespaces/team%2Fplatform/dashboards/operations%2Fdashboard",
    );
    expect(opts.method).toBe("GET");
    expect(opts.body).toBeUndefined();
    expect(result.metadata.resourceVersion).toBe("rv-opaque-42");
    expect(result.spec.futureGrafanaField).toEqual({ enabled: true, values: ["kept", 7] });
    expect(result.spec.layout).toEqual({ kind: "TabsLayout", spec: { tabs: [] } });
  });

  test("classifies a missing V2 resource as not found", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve("not found"),
    });

    const client = new GrafanaClient({ url: "http://localhost:3000", apiKey: "test-key" });
    await expect(client.getDashboardV2("default", "missing")).rejects.toThrow(
      "Not found: get V2 dashboard default/missing",
    );
  });

  test("PUTs full V2 resource to encoded item path and returns raw GET readback", async () => {
    const requestBody = makeDashboardV2Resource({
      metadata: {
        name: "operations/dashboard",
        resourceVersion: "rv-before-7",
      },
      spec: {
        title: "Operations draft",
        layout: { kind: "AutoGridLayout", spec: { columns: 12 } },
        futureGrafanaField: { enabled: false, values: ["draft"] },
      },
      status: { phase: "Pending", note: "preserve-me" },
      unknownTopLevel: { keep: true },
    });
    const readback = makeDashboardV2Resource({
      metadata: {
        name: "operations/dashboard",
        resourceVersion: "rv-after-8",
      },
      spec: {
        title: "Operations live",
        layout: { kind: "TabsLayout", spec: { tabs: [{ title: "Main" }] } },
        futureGrafanaField: { enabled: true, values: ["live", 8] },
        serverOnlyField: { checksum: "abc123" },
      },
      status: { phase: "Ready", syncedAt: "2026-08-04T05:59:00Z" },
      extraEnvelope: { observedGeneration: 3 },
    });

    fetchMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(readback),
      });

    const client = new GrafanaClient({
      url: "http://localhost:3000",
      apiKey: "test-key",
    });
    const result = await client.replaceDashboardV2("team/platform", "operations/dashboard", requestBody);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [putUrl, putOpts] = fetchMock.mock.calls[0];
    expect(putUrl).toBe(
      "http://localhost:3000/apis/dashboard.grafana.app/v2beta1/namespaces/team%2Fplatform/dashboards/operations%2Fdashboard",
    );
    expect(putOpts.method).toBe("PUT");
    expect(putOpts.body).toBe(JSON.stringify(requestBody));

    const [getUrl, getOpts] = fetchMock.mock.calls[1];
    expect(getUrl).toBe(
      "http://localhost:3000/apis/dashboard.grafana.app/v2beta1/namespaces/team%2Fplatform/dashboards/operations%2Fdashboard",
    );
    expect(getOpts.method).toBe("GET");
    expect(result).toEqual(readback);
    expect(result.spec.serverOnlyField).toEqual({ checksum: "abc123" });
    expect(result.status).toEqual({ phase: "Ready", syncedAt: "2026-08-04T05:59:00Z" });
  });

  test("replace fails fast when metadata.resourceVersion is absent or blank", async () => {
    const client = new GrafanaClient({ url: "http://localhost:3000", apiKey: "test-key" });

    await expect(
      client.replaceDashboardV2(
        "default",
        "operations/dashboard",
        makeDashboardV2Resource({ metadata: { name: "operations/dashboard", resourceVersion: "   " } }),
      ),
    ).rejects.toThrow("metadata.resourceVersion");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("replace fails fast when status is absent", async () => {
    const client = new GrafanaClient({ url: "http://localhost:3000", apiKey: "test-key" });

    await expect(
      client.replaceDashboardV2(
        "default",
        "operations/dashboard",
        makeDashboardV2Resource({ status: undefined }),
      ),
    ).rejects.toThrow("requires status");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("replace fails fast when route name and metadata.name differ", async () => {
    const client = new GrafanaClient({ url: "http://localhost:3000", apiKey: "test-key" });

    await expect(
      client.replaceDashboardV2(
        "default",
        "operations/dashboard",
        makeDashboardV2Resource({ metadata: { name: "other/dashboard", resourceVersion: "rv-1" } }),
      ),
    ).rejects.toThrow("name mismatch");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("replace surfaces 409 conflicts and skips GET readback", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: () => Promise.resolve("resourceVersion conflict"),
    });

    const client = new GrafanaClient({ url: "http://localhost:3000", apiKey: "test-key" });

    await expect(
      client.replaceDashboardV2("default", "operations/dashboard", makeDashboardV2Resource()),
    ).rejects.toThrow("Resource already exists");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
