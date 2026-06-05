export type HtmlVersionFile = {
  path: string;
  slug: string;
  version: number;
};

export type HtmlVersionGroup = {
  slug: string;
  latestPath: string;
  latestVersion: number;
  versions: HtmlVersionFile[];
};

export type HtmlFileGroups = {
  groups: HtmlVersionGroup[];
  otherFiles: string[];
};

const HTML_VERSION_PATH_PATTERN = /^([^/]+)-v([1-9]\d*)\.html$/;

export function parseHtmlVersionPath(path: string): HtmlVersionFile | undefined {
  const match = HTML_VERSION_PATH_PATTERN.exec(path);

  if (!match) {
    return undefined;
  }

  return {
    path,
    slug: match[1],
    version: Number(match[2]),
  };
}

export function groupHtmlVersionFiles(files: string[]): HtmlFileGroups {
  const groupsBySlug = new Map<string, HtmlVersionFile[]>();
  const otherFiles: string[] = [];

  for (const file of files) {
    const versionFile = parseHtmlVersionPath(file);

    if (!versionFile) {
      otherFiles.push(file);
      continue;
    }

    const versions = groupsBySlug.get(versionFile.slug) ?? [];
    versions.push(versionFile);
    groupsBySlug.set(versionFile.slug, versions);
  }

  const groups = Array.from(groupsBySlug, ([slug, versions]) => {
    const sortedVersions = [...versions].sort((left, right) => right.version - left.version);
    const latest = sortedVersions[0];

    return {
      latestPath: latest.path,
      latestVersion: latest.version,
      slug,
      versions: sortedVersions,
    };
  }).sort((left, right) => left.slug.localeCompare(right.slug));

  return {
    groups,
    otherFiles: [...otherFiles].sort((left, right) => left.localeCompare(right)),
  };
}

export function resolveLatestHtmlVersionPath(files: string[], slug: string) {
  return groupHtmlVersionFiles(files).groups.find((group) => group.slug === slug)?.latestPath;
}

export function resolveNextHtmlVersionPath(files: string[], sourcePath: string) {
  const sourceVersionFile = parseHtmlVersionPath(sourcePath);
  const slug = sourceVersionFile?.slug ?? stripHtmlExtension(sourcePath);
  const group = groupHtmlVersionFiles(files).groups.find((item) => item.slug === slug);
  const nextVersion = (group?.latestVersion ?? 0) + 1;

  return `${slug}-v${nextVersion}.html`;
}

function stripHtmlExtension(path: string) {
  return path.replace(/\.html$/i, '');
}
