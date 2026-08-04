import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GrafanaClient } from "./grafana-client.js";
import type { DashboardV2Resource } from "./grafana-dashboard-v2-types.js";

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
    const fixture: DashboardV2Resource = {
      apiVersion: "dashboard.grafana.app/v2beta1",
      kind: "Dashboard",
      metadata: {
        name: "operations/dashboard",
        resourceVersion: "rv-opaque-42",
      },
      spec: {
        title: "Operations",
        layout: { kind: "TabsLayout", spec: { tabs: [] } },
        futureGrafanaField: { enabled: true, values: ["kept", 7] },
      },
      status: { phase: "Ready" },
    };
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
});
