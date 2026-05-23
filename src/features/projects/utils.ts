export function getDeleteName(target: {
  type: "conversation" | "project";
  conversation?: { title: string };
  project?: { name: string };
}) {
  return target.type === "project"
    ? `项目“${target.project?.name ?? ""}”会被删除。`
    : `会话“${target.conversation?.title ?? ""}”会被删除。`;
}

export function filterByQuery<T>(
  items: T[],
  query: string,
  getLabel: (item: T) => string,
) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return items;
  }

  return items.filter((item) =>
    getLabel(item).toLowerCase().includes(normalizedQuery),
  );
}
