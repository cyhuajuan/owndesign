export function buildWorkspaceHref(projectId?: string, conversationId?: string) {
  if (!projectId) {
    return "/";
  }

  const params = new URLSearchParams({ projectId });

  if (conversationId) {
    params.set("conversationId", conversationId);
  }

  return `/?${params.toString()}`;
}

export function getSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
