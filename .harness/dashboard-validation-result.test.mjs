import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyValidationResult } from './dashboard-validation-result.mjs';

test('classifies mixed Vitest summary as failure', () => {
  const output = [
    ' FAIL  src/example.test.ts [ src/example.test.ts ]',
    ' Tests 4 failed | 50 passed (54)',
  ].join('\n');

  assert.equal(classifyValidationResult(output), 'FAIL');
});

test('classifies ANSI-colored Vitest failure as failure', () => {
  const output = '\u001B[31m FAIL \u001B[39m src/example.test.ts';

  assert.equal(classifyValidationResult(output), 'FAIL');
});

test('does not infer success from an incidental mention of passed', () => {
  assert.equal(
    classifyValidationResult(
      'The previous run passed only because it skipped this case.'
    ),
    'evidência registrada'
  );
});

test('classifies an explicit all-passing Vitest summary as success', () => {
  assert.equal(classifyValidationResult(' Tests 50 passed (50)'), 'PASS');
});

test('failure takes precedence over a successful-looking summary', () => {
  assert.equal(
    classifyValidationResult('Exit code: 1\nTests 50 passed (50)'),
    'FAIL'
  );
});

test('classifies unprefixed Result failure before exit-code success', () => {
  assert.equal(classifyValidationResult('Result: FAIL\nExit code: 0'), 'FAIL');
});

test('classifies unprefixed Result failure before passing test summary', () => {
  assert.equal(
    classifyValidationResult('Result: FAIL\nTests 50 passed (50)'),
    'FAIL'
  );
});

test('classifies Vitest unhandled errors before passing test summary', () => {
  assert.equal(
    classifyValidationResult('Errors 1 error(s)\nTests 50 passed (50)'),
    'FAIL'
  );
});

test('does not classify a zero Vitest error count as failure', () => {
  assert.equal(
    classifyValidationResult('Errors 0 error(s)\nTests 50 passed (50)'),
    'PASS'
  );
});

test('classifies AssertionError before successful exit-code evidence', () => {
  const output = [
    'Exit code: 0',
    'runner output: AssertionError [ERR_ASSERTION]: expected condition to be true',
  ].join('\n');

  assert.equal(classifyValidationResult(output), 'FAIL');
});

test('classifies nonzero Exit status before partial success evidence', () => {
  for (const exitStatus of [
    'Exit status 1',
    'Exit status: 1',
    'runner completed with Exit status 1',
  ]) {
    const output = ['Tests 50 passed (50)', exitStatus].join('\n');

    assert.equal(classifyValidationResult(output), 'FAIL');
  }
});

test('classifies node:test failure summaries before unrelated success output', () => {
  const failureSummaries = [
    'ℹ fail 1',
    '# fail 1',
    'not ok 1 - timed out without an assertion',
  ];

  for (const summary of failureSummaries) {
    const output = [summary, 'Tests 50 passed (50)', 'Exit code: 0'].join('\n');

    assert.equal(classifyValidationResult(output), 'FAIL', summary);
  }
});

test('does not treat zero node:test failure summaries as failure', () => {
  for (const summary of ['ℹ fail 0', '# fail 0']) {
    assert.equal(
      classifyValidationResult(`${summary}\nExit code: 0`),
      'PASS',
      summary
    );
  }
});
