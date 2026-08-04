/**
 * Internal model for Grafana's Kubernetes-style Dashboard resource.
 *
 * The V2 API may add fields to `spec` independently of this client. Keep spec
 * opaque so it is returned without narrowing it to a specific layout type.
 */

export const GRAFANA_DASHBOARD_V2_API_VERSION = "dashboard.grafana.app/v2beta1" as const;

export type GrafanaDashboardV2Metadata = {
  name: string;
  /** Opaque Kubernetes resource version populated by the server. */
  resourceVersion?: string;
  uid?: string;
  generation?: number;
  creationTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  [key: string]: unknown;
};

/** Opaque V2 dashboard spec; unknown fields are intentionally preserved. */
export type GrafanaDashboardV2Spec = Record<string, unknown>;

export type GrafanaDashboardV2<TSpec extends GrafanaDashboardV2Spec = GrafanaDashboardV2Spec> = {
  apiVersion: typeof GRAFANA_DASHBOARD_V2_API_VERSION;
  kind: "Dashboard";
  metadata: GrafanaDashboardV2Metadata;
  spec: TSpec;
  status?: unknown;
  [key: string]: unknown;
};

// Short aliases keep one resource vocabulary across client tests.
export type DashboardV2Metadata = GrafanaDashboardV2Metadata;
export type DashboardV2Spec = GrafanaDashboardV2Spec;
export type DashboardV2Resource<TSpec extends DashboardV2Spec = DashboardV2Spec> = GrafanaDashboardV2<TSpec>;
