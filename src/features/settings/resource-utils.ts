import type { ResourceLibrary } from "@/features/settings/types";

export function normalizeResourceDefaults(libraries: ResourceLibrary[]) {
  const defaultIndex = libraries.findIndex((library) => library.isDefault);

  return libraries.map((library, index) => ({
    ...library,
    isDefault: defaultIndex >= 0 ? index === defaultIndex : index === 0,
  }));
}
