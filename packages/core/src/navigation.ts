export type WorkspaceHrefInput = {
  conversationId?: string;
  previewPath?: string;
  projectId?: string;
};

export function buildWorkspaceHref({ conversationId, previewPath, projectId }: WorkspaceHrefInput) {
  if (!projectId) {
    return '/';
  }

  const pathname = conversationId
    ? `/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(
        conversationId,
      )}`
    : `/projects/${encodeURIComponent(projectId)}`;

  if (!previewPath) {
    return pathname;
  }

  const params = new URLSearchParams({ previewPath });

  return `${pathname}?${params.toString()}`;
}

export function getWorkspaceProjectId(href: string) {
  return matchWorkspaceHref(href)?.projectId;
}

function matchWorkspaceHref(href: string) {
  const url = new URL(href, 'http://owndesign.local');
  const match = url.pathname.match(/^\/projects\/([^/]+)(?:\/conversations\/([^/]+))?\/?$/);

  if (!match) {
    return undefined;
  }

  return {
    conversationId: match[2] ? decodeURIComponent(match[2]) : undefined,
    projectId: decodeURIComponent(match[1]),
  };
}
