export function filterByQuery<T>(items: T[], query: string, getLabel: (item: T) => string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return items;
  }

  return items.filter((item) => getLabel(item).toLowerCase().includes(normalizedQuery));
}
