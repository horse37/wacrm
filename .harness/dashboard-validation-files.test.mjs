import assert from 'node:assert/strict';
import test from 'node:test';
import { collectValidationFiles } from './dashboard-validation-files.mjs';

function fixtureDependencies(files, contents) {
  return {
    readdir: async () => files.map((name) => ({ name, isFile: () => true })),
    stat: async () => ({ mtime: new Date('2026-10-22T00:00:00.000Z') }),
    readFile: async (path) => {
      const name = path.split(/[\\/]/).at(-1);
      const content = contents[name];
      if (content instanceof Error) throw content;
      return content;
    },
  };
}

test('collects and classifies validation and review files', async () => {
  const rows = await collectValidationFiles(
    'fixture',
    fixtureDependencies(['validation-pass.log', 'review-approved.md'], {
      'validation-pass.log': 'Overall result: PASS\nTests 1 passed\n',
      'review-approved.md': 'APPROVE\nFindings: 0\nCaveats: 0\n',
    })
  );

  assert.deepEqual(
    rows.map(({ name, result }) => ({ name, result })),
    [
      { name: 'validation-pass.log', result: 'PASS' },
      { name: 'review-approved.md', result: 'APPROVE' },
    ]
  );
});

test('propagates an individual evidence readFile failure', async () => {
  const readFailure = Object.assign(new Error('read denied'), {
    code: 'EACCES',
  });
  const dependencies = fixtureDependencies(['validation-unreadable.log'], {
    'validation-unreadable.log': readFailure,
  });

  await assert.rejects(
    collectValidationFiles('fixture', dependencies),
    (error) => error === readFailure
  );
});
