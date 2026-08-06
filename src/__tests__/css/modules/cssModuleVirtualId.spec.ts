import { describe, expect, test } from 'vitest';
import {
  cssModuleFileFromVirtualId,
  isCssModuleCssVirtualModuleId,
  isCssModuleLocalsVirtualModuleId,
  isCssModuleRootStyleVirtualModuleId,
  isCssModuleStyleAssetVirtualModuleId,
  isCssModuleVirtualModuleId,
  resolveCssModuleStyleAssetVirtualId,
  toCssModuleStyleAssetBrowserUrl,
  toResolvedCssModuleStyleAssetVirtualId,
  toCssModuleStyleVirtualId,
  toCssModuleVirtualId,
} from '#auklet/css/vite/cssModuleVirtualId';

describe('CSS Module virtual IDs', () => {
  const moduleFile = '/workspace/src/Tag.module.less';
  const assetFile = '/workspace/src/tokens.less';

  test('distinguishes locals, root style, and sibling asset IDs', () => {
    const localsId = toCssModuleVirtualId(moduleFile);
    const rootStyleId = toCssModuleStyleVirtualId(moduleFile);
    const assetId = toResolvedCssModuleStyleAssetVirtualId(
      moduleFile,
      assetFile,
    );

    expect(isCssModuleLocalsVirtualModuleId(localsId)).toBe(true);
    expect(isCssModuleRootStyleVirtualModuleId(localsId)).toBe(false);
    expect(isCssModuleStyleAssetVirtualModuleId(localsId)).toBe(false);

    expect(isCssModuleLocalsVirtualModuleId(rootStyleId)).toBe(false);
    expect(isCssModuleRootStyleVirtualModuleId(rootStyleId)).toBe(true);
    expect(isCssModuleStyleAssetVirtualModuleId(rootStyleId)).toBe(false);

    expect(isCssModuleLocalsVirtualModuleId(assetId)).toBe(false);
    expect(isCssModuleRootStyleVirtualModuleId(assetId)).toBe(false);
    expect(isCssModuleStyleAssetVirtualModuleId(assetId)).toBe(true);

    expect(isCssModuleCssVirtualModuleId(localsId)).toBe(false);
    expect(isCssModuleCssVirtualModuleId(rootStyleId)).toBe(true);
    expect(isCssModuleCssVirtualModuleId(assetId)).toBe(true);
    expect(isCssModuleVirtualModuleId(localsId)).toBe(true);
    expect(isCssModuleVirtualModuleId(rootStyleId)).toBe(true);
    expect(isCssModuleVirtualModuleId(assetId)).toBe(true);
  });

  test('resolves owner and asset files from resolved and browser IDs', () => {
    for (const id of [
      toResolvedCssModuleStyleAssetVirtualId(moduleFile, assetFile),
      toCssModuleStyleAssetBrowserUrl(moduleFile, assetFile),
    ]) {
      expect(resolveCssModuleStyleAssetVirtualId(id)).toMatchObject({
        moduleFile,
        assetFile,
      });
      expect(cssModuleFileFromVirtualId(id)).toBe(moduleFile);
    }
  });
});
