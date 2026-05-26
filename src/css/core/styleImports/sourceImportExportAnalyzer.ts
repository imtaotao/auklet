import ts from 'typescript';

export type ModuleImportReference = {
  importPath: string;
  importClause?: ts.ImportClause;
  importedNames?: Array<string>;
  isTypeOnly?: boolean;
  hasNamespaceImport?: boolean;
};

type ImportBinding = {
  importPath: string;
  importedName: string;
  isTypeOnly: boolean;
  hasNamespaceImport: boolean;
};

export function collectModuleImportReferences(file: string, code: string) {
  const imports: Array<ModuleImportReference> = [];
  const importBindings = new Map<string, ImportBinding>();
  const localDeclarations = new Set<string>();
  const sourceFile = ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    false,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  sourceFile.forEachChild((node) => {
    collectLocalDeclarationNames(node, localDeclarations);

    if (ts.isImportDeclaration(node)) {
      collectImportBindings(node, importBindings);
    }
  });

  sourceFile.forEachChild((node) => {
    if (ts.isImportDeclaration(node)) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) {
        return;
      }
      imports.push({
        importPath: node.moduleSpecifier.text,
        importClause: node.importClause,
      });
      return;
    }

    if (ts.isExportDeclaration(node)) {
      collectExportDeclaration(
        file,
        node,
        imports,
        importBindings,
        localDeclarations,
      );
    }
  });
  return imports;
}

export function isTypeOnlyModuleReference(item: ModuleImportReference) {
  return isTypeOnlyImportClause(item.importClause) || item.isTypeOnly;
}

export function getModuleReferenceImportedNames(
  file: string,
  item: ModuleImportReference,
) {
  if (item.importedNames) {
    if (item.isTypeOnly) return [];
    if (item.hasNamespaceImport) {
      throw createNamespaceImportError(file, item.importPath);
    }
    return item.importedNames;
  }

  const importClause = item.importClause;
  if (!importClause || isTypeOnlyImportClause(importClause)) {
    return [];
  }
  const names: Array<string> = [];
  if (importClause.name) {
    names.push(importClause.name.text);
  }
  const namedBindings = importClause.namedBindings;

  if (!namedBindings) {
    return names;
  }
  if (ts.isNamespaceImport(namedBindings)) {
    throw createNamespaceImportError(file, item.importPath);
  }
  for (const element of namedBindings.elements) {
    if (element.isTypeOnly) continue;
    names.push((element.propertyName ?? element.name).text);
  }
  return names;
}

const collectLocalDeclarationNames = (
  node: ts.Node,
  localDeclarations: Set<string>,
) => {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)) &&
    node.name
  ) {
    localDeclarations.add(node.name.text);
    return;
  }

  if (!ts.isVariableStatement(node)) return;

  for (const declaration of node.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name)) {
      localDeclarations.add(declaration.name.text);
    }
  }
};

const collectImportBindings = (
  node: ts.ImportDeclaration,
  importBindings: Map<string, ImportBinding>,
) => {
  if (!ts.isStringLiteral(node.moduleSpecifier) || !node.importClause) {
    return;
  }

  const importPath = node.moduleSpecifier.text;
  const isTypeOnly = isTypeOnlyImportClause(node.importClause);

  if (node.importClause.name) {
    const importedName = node.importClause.name.text;
    importBindings.set(importedName, {
      importPath,
      importedName,
      isTypeOnly,
      hasNamespaceImport: false,
    });
  }

  const namedBindings = node.importClause.namedBindings;
  if (!namedBindings) return;

  if (ts.isNamespaceImport(namedBindings)) {
    importBindings.set(namedBindings.name.text, {
      importPath,
      importedName: namedBindings.name.text,
      isTypeOnly,
      hasNamespaceImport: true,
    });
    return;
  }

  for (const element of namedBindings.elements) {
    const importedName = (element.propertyName ?? element.name).text;
    importBindings.set(element.name.text, {
      importPath,
      importedName,
      isTypeOnly: isTypeOnly || element.isTypeOnly,
      hasNamespaceImport: false,
    });
  }
};

const collectExportDeclaration = (
  file: string,
  node: ts.ExportDeclaration,
  imports: Array<ModuleImportReference>,
  importBindings: Map<string, ImportBinding>,
  localDeclarations: Set<string>,
) => {
  if (node.moduleSpecifier) {
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    if (!node.exportClause || !ts.isNamedExports(node.exportClause)) {
      throw new Error(
        `[css] Export-all declarations are not supported for CSS auto import: ${node.moduleSpecifier.text}\n` +
          `Use named exports instead, for example: export { Component } from '${node.moduleSpecifier.text}'.\n` +
          `File: ${file}`,
      );
    }

    imports.push({
      importPath: node.moduleSpecifier.text,
      importedNames: getExportedNames(node),
      isTypeOnly: node.isTypeOnly,
    });
    return;
  }

  if (!node.exportClause || !ts.isNamedExports(node.exportClause)) {
    return;
  }

  for (const element of node.exportClause.elements) {
    if (node.isTypeOnly || element.isTypeOnly) continue;

    const localName = (element.propertyName ?? element.name).text;
    const binding = importBindings.get(localName);

    if (binding) {
      imports.push({
        importPath: binding.importPath,
        importedNames: [binding.importedName],
        isTypeOnly: binding.isTypeOnly,
        hasNamespaceImport: binding.hasNamespaceImport,
      });
      continue;
    }

    if (!localDeclarations.has(localName)) {
      throw new Error(
        `[css] Unable to resolve exported symbol "${localName}" for CSS auto import.\n` +
          `File: ${file}`,
      );
    }
  }
};

const getExportedNames = (node: ts.ExportDeclaration) => {
  if (!node.exportClause || !ts.isNamedExports(node.exportClause)) {
    return [];
  }

  return node.exportClause.elements
    .filter((element) => !element.isTypeOnly)
    .map((element) => (element.propertyName ?? element.name).text);
};

const isTypeOnlyImportClause = (importClause?: ts.ImportClause) => {
  return importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
};

const createNamespaceImportError = (file: string, importPath: string) => {
  return new Error(
    `Namespace import is not supported for CSS auto import: ${importPath}\n` +
      `Use named imports instead, for example: import { Component } from '${importPath}'.\n` +
      `File: ${file}`,
  );
};
