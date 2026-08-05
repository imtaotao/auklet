import type { Root } from 'postcss';

const skipAtRuleNames = new Set([
  'keyframes',
  '-webkit-keyframes',
  'font-face',
  'property',
]);

export function prefixSelectors(root: Root, prefix: string) {
  if (!prefix) return root;

  root.walkRules((rule) => {
    if (!rule.selectors?.length) return;

    for (
      let parent:
        | { type?: string; name?: string; parent?: unknown }
        | undefined = rule.parent as
        | { type?: string; name?: string; parent?: unknown }
        | undefined;
      parent;
      parent = parent.parent as
        | { type?: string; name?: string; parent?: unknown }
        | undefined
    ) {
      if (
        parent.type === 'atrule' &&
        parent.name &&
        skipAtRuleNames.has(parent.name)
      ) {
        return;
      }
    }

    rule.selectors = rule.selectors.map((selector) => {
      const trimmed = selector.trim();
      if (!trimmed) return selector;
      if (trimmed === prefix || trimmed.startsWith(`${prefix} `)) {
        return selector;
      }
      return `${prefix} ${trimmed}`;
    });
  });

  return root;
}
