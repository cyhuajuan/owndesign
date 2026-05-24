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
