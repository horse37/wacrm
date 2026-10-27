import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const sourceRoot = path.join(root, 'src');
const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'];

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory()
      ? filesUnder(file)
      : extensions.includes(path.extname(file))
        ? [path.resolve(file)]
        : [];
  });
}

function parse(file, text) {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') || file.endsWith('.jsx')
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS
  );
}

function clientDirective(source) {
  for (const statement of source.statements) {
    if (
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression)
    ) {
      if (statement.expression.text === 'use client') return true;
      continue;
    }
    break;
  }
  return false;
}

function runtimeImports(source) {
  const imports = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      if (
        clause?.name === undefined &&
        clause?.namedBindings &&
        ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.length > 0 &&
        clause.namedBindings.elements.every((item) => item.isTypeOnly)
      )
        continue;
      if (ts.isStringLiteral(statement.moduleSpecifier)) {
        imports.push(statement.moduleSpecifier.text);
      }
    } else if (ts.isImportEqualsDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      const reference = statement.moduleReference;
      if (ts.isExternalModuleReference(reference)) {
        const expression = reference.expression;
        imports.push(
          expression && ts.isStringLiteralLike(expression)
            ? expression.text
            : null
        );
      }
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      if (
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause) &&
        statement.exportClause.elements.length > 0 &&
        statement.exportClause.elements.every((item) => item.isTypeOnly)
      ) {
        continue;
      }
      if (
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
      )
        imports.push(statement.moduleSpecifier.text);
    }
  }
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    ) {
      const arg = node.arguments[0];
      imports.push(arg && ts.isStringLiteralLike(arg) ? arg.text : null);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return imports;
}

function resolveLocal(importer, specifier) {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) {
    return { kind: 'external' };
  }
  const base = specifier.startsWith('@/')
    ? path.join(sourceRoot, specifier.slice(2))
    : path.resolve(path.dirname(importer), specifier);
  const ext = path.extname(base);
  if (ext && !extensions.includes(ext)) return { kind: 'external' };
  const candidates = ext
    ? [base]
    : [
        ...extensions.map((item) => base + item),
        ...extensions.map((item) => path.join(base, 'index' + item)),
      ];
  const found = candidates.find(fs.existsSync);
  return found
    ? { kind: 'local', path: path.resolve(found) }
    : { kind: 'unresolved', path: base };
}

function protectedModule(file) {
  const normalized = file.split(path.sep).join('/').toLowerCase();
  return (
    normalized.includes('/src/lib/db/postgres-pool.') ||
    normalized.includes('/src/lib/db/postgres-client.') ||
    normalized.includes('/src/lib/repositories/')
  );
}

function scan(entries, read, resolve) {
  const violations = [];
  for (const entry of entries) {
    const pending = [entry];
    const visited = new Set();
    while (pending.length) {
      const file = pending.pop();
      if (visited.has(file)) continue;
      visited.add(file);
      const content = read(file);
      if (content === undefined) {
        violations.push({ file, reason: 'unreadable-local-module' });
        continue;
      }
      for (const specifier of runtimeImports(parse(file, content))) {
        if (specifier === null) {
          violations.push({ file, reason: 'non-literal-runtime-import' });
          continue;
        }
        if (specifier === 'pg' || specifier.startsWith('pg/')) {
          violations.push({
            file,
            specifier,
            reason: 'postgres-driver-import',
          });
          continue;
        }
        const result = resolve(file, specifier);
        if (result.kind === 'unresolved') {
          violations.push({
            file: result.path,
            specifier,
            reason: 'unresolved-local-import',
          });
        } else if (result.kind === 'local') {
          if (protectedModule(result.path)) {
            violations.push({
              file: result.path,
              specifier,
              reason: 'postgres-server-module-import',
            });
          } else {
            pending.push(result.path);
          }
        }
      }
    }
  }
  return violations;
}

function virtualResolver(files) {
  return (importer, specifier) => {
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) {
      return { kind: 'external' };
    }
    const base = specifier.startsWith('@/')
      ? path.posix.resolve('/v/src', specifier.slice(2))
      : path.posix.resolve(path.posix.dirname(importer), specifier);
    const candidates = path.posix.extname(base)
      ? [base]
      : [base + '.ts', base + '.tsx', base + '.js', base + '.jsx'];
    const found = candidates.find((candidate) => files.has(candidate));
    return found
      ? { kind: 'local', path: found }
      : { kind: 'unresolved', path: base };
  };
}

test('PostgreSQL runtime modules import server-only', () => {
  const files = filesUnder(sourceRoot);
  const modules = files.filter((file) =>
    runtimeImports(parse(file, fs.readFileSync(file, 'utf8'))).some(
      (specifier) => specifier === 'pg' || specifier?.startsWith('pg/')
    )
  );
  assert.ok(modules.length > 0);
  for (const file of modules) {
    assert.ok(
      runtimeImports(parse(file, fs.readFileSync(file, 'utf8'))).includes(
        'server-only'
      ),
      path.relative(root, file) + ' lacks server-only guard'
    );
  }
});

test('client-component graphs cannot reach PostgreSQL modules', () => {
  const files = filesUnder(sourceRoot);
  const entries = files.filter((file) =>
    clientDirective(parse(file, fs.readFileSync(file, 'utf8')))
  );
  assert.ok(entries.length > 0);
  assert.deepEqual(
    scan(entries, (file) => fs.readFileSync(file, 'utf8'), resolveLocal),
    []
  );
});

test('scanner detects transitive and dynamic pg imports', () => {
  const transitive = new Map([
    ['/v/src/client.tsx', "'use client'; import { x } from '@/bridge';"],
    ['/v/src/bridge.ts', "export { x } from './pool';"],
    ['/v/src/pool.ts', "import { Pool } from 'pg';"],
  ]);
  const found = scan(
    ['/v/src/client.tsx'],
    (file) => transitive.get(file),
    virtualResolver(transitive)
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].reason, 'postgres-driver-import');

  const dynamic = new Map([
    ['/v/src/client.tsx', "'use client'; void import('./pool');"],
    ['/v/src/pool.ts', "import { Pool } from 'pg';"],
  ]);
  const dynamicFound = scan(
    ['/v/src/client.tsx'],
    (file) => dynamic.get(file),
    virtualResolver(dynamic)
  );
  assert.equal(dynamicFound.length, 1);
  assert.equal(dynamicFound[0].reason, 'postgres-driver-import');

  const typeOnly = new Map([
    ['/v/src/client.tsx', "import type { Pool } from './pool';"],
    ['/v/src/pool.ts', "import { Pool } from 'pg';"],
  ]);
  assert.deepEqual(
    scan(
      ['/v/src/client.tsx'],
      (file) => typeOnly.get(file),
      virtualResolver(typeOnly)
    ),
    []
  );

  const typeOnlyExport = new Map([
    ['/v/src/client.tsx', "'use client'; export type { Pool } from './pool';"],
    ['/v/src/pool.ts', "import { Pool } from 'pg';"],
  ]);
  assert.deepEqual(
    scan(
      ['/v/src/client.tsx'],
      (file) => typeOnlyExport.get(file),
      virtualResolver(typeOnlyExport)
    ),
    []
  );
});

test('scanner follows runtime TypeScript import-equals references', () => {
  const importEquals = new Map([
    ['/v/src/client.tsx', "'use client'; import bridge = require('@/bridge');"],
    ['/v/src/bridge.ts', "import pool = require('./pool');"],
    ['/v/src/pool.ts', "import pg = require('pg');"],
  ]);
  const found = scan(
    ['/v/src/client.tsx'],
    (file) => importEquals.get(file),
    virtualResolver(importEquals)
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].reason, 'postgres-driver-import');

  const typeOnly = new Map([
    ['/v/src/client.tsx', "import type bridge = require('./bridge');"],
    ['/v/src/bridge.ts', "import pg = require('pg');"],
  ]);
  assert.deepEqual(
    scan(
      ['/v/src/client.tsx'],
      (file) => typeOnly.get(file),
      virtualResolver(typeOnly)
    ),
    []
  );

  const nonLiteral = new Map([
    ['/v/src/client.tsx', 'import bridge = require(moduleName);'],
  ]);
  assert.deepEqual(
    scan(
      ['/v/src/client.tsx'],
      (file) => nonLiteral.get(file),
      virtualResolver(nonLiteral)
    ),
    [{ file: '/v/src/client.tsx', reason: 'non-literal-runtime-import' }]
  );
});
