/**
 * Helpers for validating and auditing Grafana Dashboard API V2 layouts.
 *
 * The V2 layout schema is intentionally treated as opaque/forward-compatible.
 * We only inspect the narrow pieces needed for safe layout updates:
 * - TabsLayout tab titles (Grafana 13 ASCII slug safety)
 * - ElementReference names against existing spec.elements
 */

export type DashboardV2LayoutAudit = {
  layoutKind: string;
  tabTitles: string[];
  tabSlugs: string[];
  elementReferenceCount: number;
  missingElementReferences: string[];
  warnings: string[];
};

export type DashboardV2LayoutValidationResult = {
  audit: DashboardV2LayoutAudit;
};

type TabSlugRecord = {
  title: string;
  slug: string;
  path: string;
};

type TabTitleReadResult = {
  title: string;
  path: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function slugifyTabsLayoutTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function readElementReferenceName(node: Record<string, unknown>): string | undefined {
  const spec = isRecord(node.spec) ? node.spec : undefined;
  const candidates = [spec?.name, spec?.elementName, node.name];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
  }
  return undefined;
}

function extractExistingElementNames(elements: unknown): Set<string> {
  const names = new Set<string>();

  if (Array.isArray(elements)) {
    for (const item of elements) {
      if (isRecord(item) && typeof item.name === "string" && item.name.trim() !== "") {
        names.add(item.name);
      }
    }
    return names;
  }

  if (!isRecord(elements)) return names;

  for (const [key, value] of Object.entries(elements)) {
    if (key.trim() !== "") names.add(key);
    if (isRecord(value) && typeof value.name === "string" && value.name.trim() !== "") {
      names.add(value.name);
    }
  }

  return names;
}

function readTabsLayoutTabTitle(tab: unknown, basePath: string): TabTitleReadResult {
  const titlePath = `${basePath}.spec.title`;
  if (!isRecord(tab)) return { title: "", path: titlePath };

  const spec = isRecord(tab.spec) ? tab.spec : undefined;
  if (typeof spec?.title === "string") {
    return { title: spec.title, path: titlePath };
  }

  if (typeof tab.title === "string") {
    return { title: tab.title, path: `${basePath}.title` };
  }

  return { title: "", path: titlePath };
}

export function validateDashboardV2Layout(
  layout: unknown,
  existingElements: unknown,
): DashboardV2LayoutValidationResult {
  if (!isRecord(layout)) {
    throw new Error("V2 layout must be an object.");
  }

  const tabRecords: TabSlugRecord[] = [];
  const elementReferenceNames: string[] = [];
  const warnings: string[] = [];
  const seenSlugs = new Map<string, TabSlugRecord>();

  const visit = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    if (!isRecord(node)) return;

    if (node.kind === "TabsLayout") {
      const spec = isRecord(node.spec) ? node.spec : undefined;
      const tabs = Array.isArray(spec?.tabs) ? spec.tabs : [];
      tabs.forEach((tab, index) => {
        const { title, path: titlePath } = readTabsLayoutTabTitle(tab, `${path}.spec.tabs[${index}]`);
        const slug = slugifyTabsLayoutTitle(title);

        if (slug === "") {
          throw new Error(
            `TabsLayout tab title at ${titlePath} becomes an empty ASCII slug. Rename it with a unique ASCII/number prefix, for example \"01 Обзор\" and \"02 Пользователи\".`,
          );
        }

        const firstSeen = seenSlugs.get(slug);
        if (firstSeen) {
          throw new Error(
            `TabsLayout tab titles at ${firstSeen.path} (${JSON.stringify(firstSeen.title)}) and ${titlePath} (${JSON.stringify(title)}) both slugify to \"${slug}\". Make them unique, for example \"01 Overview\" and \"02 Overview API\".`,
          );
        }

        const record = { title, slug, path: titlePath };
        seenSlugs.set(slug, record);
        tabRecords.push(record);
      });
    }

    if (node.kind === "ElementReference") {
      const name = readElementReferenceName(node);
      if (name) {
        elementReferenceNames.push(name);
      } else {
        warnings.push(`ElementReference at ${path} has no string spec.name; skipped.`);
      }
    }

    for (const [key, value] of Object.entries(node)) {
      visit(value, `${path}.${key}`);
    }
  };

  visit(layout, "$layout");

  const existingNames = extractExistingElementNames(existingElements);
  const missingElementReferences = [...new Set(
    elementReferenceNames.filter((name) => !existingNames.has(name)),
  )];

  if (missingElementReferences.length > 0) {
    throw new Error(
      `Layout references element(s) missing from resource.spec.elements: ${missingElementReferences.join(", ")}. Add those element definitions first or update the ElementReference names.`,
    );
  }

  return {
    audit: {
      layoutKind: typeof layout.kind === "string" ? layout.kind : "unknown",
      tabTitles: tabRecords.map((record) => record.title),
      tabSlugs: tabRecords.map((record) => record.slug),
      elementReferenceCount: elementReferenceNames.length,
      missingElementReferences,
      warnings,
    },
  };
}
