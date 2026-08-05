import { describe, expect, test } from "vitest";
import {
  slugifyTabsLayoutTitle,
  validateDashboardV2Layout,
} from "./grafana-dashboard-v2-layout.js";

describe("grafana-dashboard-v2-layout", () => {
  test("slugifies tab titles with ASCII-only rule", () => {
    expect(slugifyTabsLayoutTitle("01 Обзор")).toBe("01");
    expect(slugifyTabsLayoutTitle("Overview API")).toBe("overview-api");
    expect(slugifyTabsLayoutTitle("  Main__Tab  ")).toBe("main-tab");
  });

  test("audits nested TabsLayout tabs and records canonical spec titles", () => {
    const layout = {
      kind: "RowsLayout",
      spec: {
        rows: [
          {
            kind: "RowsLayoutRow",
            spec: {
              layout: {
                kind: "TabsLayout",
                spec: {
                  tabs: [
                    {
                      kind: "TabsLayoutTab",
                      spec: {
                        title: "01 Обзор",
                        layout: {
                          kind: "ElementReference",
                          spec: { name: "overview" },
                        },
                      },
                    },
                    {
                      kind: "TabsLayoutTab",
                      spec: {
                        title: "02 API",
                        layout: {
                          kind: "AutoGridLayout",
                          spec: {
                            items: [
                              {
                                kind: "ElementReference",
                                spec: { name: "api-latency" },
                              },
                            ],
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    };

    const result = validateDashboardV2Layout(layout, {
      overview: { kind: "Panel" },
      "api-latency": { kind: "Panel" },
    });

    expect(result.audit).toEqual({
      layoutKind: "RowsLayout",
      tabTitles: ["01 Обзор", "02 API"],
      tabSlugs: ["01", "02-api"],
      elementReferenceCount: 2,
      missingElementReferences: [],
      warnings: [],
    });
  });

  test("rejects tab titles whose ASCII slug becomes empty", () => {
    const layout = {
      kind: "TabsLayout",
      spec: {
        tabs: [{ kind: "TabsLayoutTab", spec: { title: "Обзор" } }],
      },
    };

    expect(() => validateDashboardV2Layout(layout, {})).toThrow(
      /empty ASCII slug.*01 Обзор.*02 Пользователи/,
    );
  });

  test("rejects duplicate tab slugs", () => {
    const layout = {
      kind: "TabsLayout",
      spec: {
        tabs: [
          { kind: "TabsLayoutTab", spec: { title: "Overview API" } },
          { kind: "TabsLayoutTab", spec: { title: "overview-api" } },
        ],
      },
    };

    expect(() => validateDashboardV2Layout(layout, {})).toThrow(/both slugify to "overview-api"/);
  });

  test("uses nested audit path for pure Cyrillic nested titles", () => {
    const emptyLayout = {
      kind: "RowsLayout",
      spec: {
        rows: [
          {
            kind: "RowsLayoutRow",
            spec: {
              layout: {
                kind: "TabsLayout",
                spec: {
                  tabs: [{ kind: "TabsLayoutTab", spec: { title: "Инфраструктура" } }],
                },
              },
            },
          },
        ],
      },
    };

    expect(() => validateDashboardV2Layout(emptyLayout, {})).toThrow(
      /\$layout\.spec\.rows\[0\]\.spec\.layout\.spec\.tabs\[0\]\.spec\.title/,
    );
  });

  test("uses nested audit path for duplicate nested ASCII slugs", () => {
    const duplicateLayout = {
      kind: "RowsLayout",
      spec: {
        rows: [
          {
            kind: "RowsLayoutRow",
            spec: {
              layout: {
                kind: "TabsLayout",
                spec: {
                  tabs: [
                    { kind: "TabsLayoutTab", spec: { title: "Overview API" } },
                    { kind: "TabsLayoutTab", spec: { title: "overview-api" } },
                  ],
                },
              },
            },
          },
        ],
      },
    };

    expect(() => validateDashboardV2Layout(duplicateLayout, {})).toThrow(
      /\$layout\.spec\.rows\[0\]\.spec\.layout\.spec\.tabs\[0\]\.spec\.title.*\$layout\.spec\.rows\[0\]\.spec\.layout\.spec\.tabs\[1\]\.spec\.title/,
    );
  });

  test("rejects missing ElementReference names", () => {
    const layout = {
      kind: "AutoGridLayout",
      spec: {
        items: [
          {
            kind: "ElementReference",
            spec: { name: "known" },
          },
          {
            kind: "ElementReference",
            spec: { name: "missing" },
          },
        ],
      },
    };

    expect(() => validateDashboardV2Layout(layout, { known: {} })).toThrow(
      /missing from resource\.spec\.elements: missing/,
    );
  });
});
