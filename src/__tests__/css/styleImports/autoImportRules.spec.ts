import { describe, expect, test } from 'vitest';
import { normalizeAukletConfig } from '#auklet/config';
import {
  createDirectStyleAutoImportSpecifier,
  createStyleAutoImportRules,
  createStyleAutoImportSpecifier,
  matchStyleAutoImportRules,
} from '#auklet/css/core/styleImports/autoImportRules';

describe('style auto import rules', () => {
  test('creates rules from dependency component style config', () => {
    const rules = createStyleAutoImportRules(
      normalizeAukletConfig({
        styles: {
          dependencies: {
            '@scope/ui': {
              components: ['/components/**.css', '/blocks/*.css'],
            },
            '@scope/theme': {
              entry: '/style.css',
            },
          },
        },
      }),
    );

    expect(rules).toEqual([
      {
        packageName: '@scope/ui',
        outputPattern: '@scope/ui/components/**.css',
      },
      {
        packageName: '@scope/ui',
        outputPattern: '@scope/ui/blocks/*.css',
      },
    ]);
  });

  test('matches package entry and deep import paths', () => {
    const rules = [
      {
        packageName: '@scope/ui',
        outputPattern: '@scope/ui/components/**.css',
      },
    ];

    expect(matchStyleAutoImportRules(rules, '@scope/ui')).toEqual([
      {
        rule: rules[0],
        values: [],
      },
    ]);
    expect(
      matchStyleAutoImportRules(rules, '@scope/ui/components/Button'),
    ).toEqual([
      {
        rule: rules[0],
        values: ['components', 'Button'],
      },
    ]);
    expect(matchStyleAutoImportRules(rules, '@scope/unknown')).toEqual([]);
  });

  test('creates specifiers from package entry imported names', () => {
    const rule = {
      packageName: '@scope/ui',
      outputPattern: '@scope/ui/components/**.css',
    };

    expect(createStyleAutoImportSpecifier(rule, [], 'Button')).toBe(
      '@scope/ui/components/Button.css',
    );
  });

  test('creates direct specifiers from deep import paths', () => {
    const rule = {
      packageName: '@scope/ui',
      outputPattern: '@scope/ui/components/**.css',
    };

    expect(
      createDirectStyleAutoImportSpecifier(rule, '@scope/ui/components/Button'),
    ).toBe('@scope/ui/components/Button.css');
    expect(createDirectStyleAutoImportSpecifier(rule, '@scope/ui')).toBeNull();
  });
});
