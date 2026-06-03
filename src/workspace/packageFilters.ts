export function matchesWorkspacePackageFilter(
  packageName: string,
  filter: string,
) {
  if (filter === '*') return true;

  if (filter.endsWith('/*')) {
    const scope = filter.slice(0, -2);
    return packageName.startsWith(`${scope}/`);
  }
  return packageName === filter;
}

export function isExactlyMatchedByWorkspaceFilter(
  packageName: string,
  filters: Array<string>,
) {
  return filters.some((filter) => filter === packageName);
}
