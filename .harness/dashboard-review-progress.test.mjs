import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateReviewResult,
  classifyReview,
  isHData003Task,
  reviewFilesForTask,
  summarizeReviewProgress,
  taskStatus,
  taskStatusLabel,
} from './dashboard-review-progress.mjs';

test('uses named review rounds instead of file modification time', () => {
  const current = aggregateReviewResult([
    {
      name: 'review-p2-3-initial-20261021.md',
      text: 'Verdict: REMEDIATION_REQUIRED\nScope: P2-3 only',
      updatedAtMs: 999,
    },
    {
      name: 'review-p2-3-independent-20261021-r2.md',
      text: 'Final verdict: APPROVE\nFindings: zero\nCaveats: zero\nScope: P2-3 only',
      updatedAtMs: 1,
    },
  ]);

  assert.equal(current, 'APPROVE');
});

test('a newer broad rejection outranks an older approval with a higher round', () => {
  const current = aggregateReviewResult([
    {
      name: 'review-opus-working-tree-independent-20261022-r6.md',
      text: [
        'Scope: working tree',
        'Final verdict: APPROVE',
        'Findings: zero',
        'Caveats: zero',
      ].join('\n'),
    },
    {
      name: 'review-opus-working-tree-remediation-20261023-r1.md',
      text: [
        'Scope: working tree',
        'Verdict: REMEDIATION_REQUIRED',
        'Findings: 1',
        'Caveats: 0',
      ].join('\n'),
    },
  ]);

  assert.equal(current, 'REMEDIATION_REQUIRED');
});

test('a later same-day review timestamp outranks an older higher round', () => {
  const current = aggregateReviewResult([
    {
      name: 'review-opus-working-tree-independent-20261023-090000-r6.md',
      text: [
        'Scope: working tree',
        'Final verdict: APPROVE',
        'Findings: zero',
        'Caveats: zero',
      ].join('\n'),
    },
    {
      name: 'review-opus-working-tree-remediation-20261023-1000-r1.md',
      text: [
        'Scope: working tree',
        'Verdict: REMEDIATION_REQUIRED',
        'Findings: 1',
        'Caveats: 0',
      ].join('\n'),
    },
  ]);

  assert.equal(current, 'REMEDIATION_REQUIRED');
});

test('a broad working-tree rejection stays open despite later slice approvals', () => {
  const current = aggregateReviewResult([
    {
      name: 'review-opus-working-tree-20261023.md',
      text: [
        'Scope: working tree; A1–A5',
        'Verdict: REMEDIATION_REQUIRED',
        'Findings: 1',
        'Caveats: 0',
      ].join('\n'),
    },
    {
      name: 'review-a1-independent-20261024-r1.md',
      text: [
        'Scope: A1 only',
        'Final verdict: APPROVE',
        'Findings: zero',
        'Caveats: zero',
      ].join('\n'),
    },
    {
      name: 'review-a5-independent-20261024-r1.md',
      text: [
        'Scope: A5 only',
        'Final verdict: APPROVE',
        'Findings: zero',
        'Caveats: zero',
      ].join('\n'),
    },
  ]);

  assert.equal(current, 'REMEDIATION_REQUIRED');
});

test('a newer broad approval supersedes the previous broad rejection', () => {
  const current = aggregateReviewResult([
    {
      name: 'review-opus-working-tree-remediation-20261022-r6.md',
      text: [
        'Scope: working tree; A1–A5',
        'Verdict: REMEDIATION_REQUIRED',
        'Findings: 1',
        'Caveats: 0',
      ].join('\n'),
    },
    {
      name: 'review-opus-working-tree-independent-20261023-r1.md',
      text: [
        'Scope: full working tree',
        'Final verdict: APPROVE',
        'Findings: zero',
        'Caveats: zero',
      ].join('\n'),
    },
  ]);

  assert.equal(current, 'APPROVE');
});

test('does not treat the referenced Opus round as a newer Luna review round', () => {
  const current = aggregateReviewResult([
    {
      name: 'review-p2-1-initial-20261021.md',
      text: [
        'Scope: P2-1 only — Opus round 2 finding 1.',
        'Verdict: REMEDIATION_REQUIRED.',
      ].join('\n'),
    },
    {
      name: 'review-p2-1-independent-20261021.md',
      text: [
        'Scope: P2-1 only.',
        'Final verdict: APPROVE.',
        'Findings: zero.',
        'Caveats: zero.',
      ].join('\n'),
    },
  ]);

  assert.equal(current, 'APPROVE');
});

test('keeps every finding scope visible when one scope remains unresolved', () => {
  const current = aggregateReviewResult([
    {
      name: 'review-p2-3-independent-20261021.md',
      text: 'Final verdict: APPROVE\nFindings: zero\nCaveats: zero',
    },
    {
      name: 'review-p3-1-independent-20261021.md',
      text: 'Verdict: REMEDIATION_REQUIRED\nFindings: 1\nCaveats: 0',
    },
  ]);

  assert.equal(current, 'REMEDIATION_REQUIRED');
});

test('associates a multi-scope review with every finding it declares', () => {
  const current = aggregateReviewResult([
    {
      name: 'review-p2-2-initial-20261021.md',
      text: 'Verdict: REMEDIATION_REQUIRED\nScope: P2-2 and P3-1',
    },
    {
      name: 'review-p2-2-independent-20261021-r2.md',
      text: 'Final verdict: APPROVE\nFindings: zero\nCaveats: zero\nScope: P2-2 only',
    },
  ]);

  assert.equal(current, 'REMEDIATION_REQUIRED');
});

test('does not choose between conflicting reviews with the same recorded order', () => {
  const current = aggregateReviewResult([
    {
      name: 'review-p3-1-final-20261021-a.md',
      text: 'Final verdict: APPROVE\nFindings: zero\nCaveats: zero',
    },
    {
      name: 'review-p3-1-final-20261021-b.md',
      text: 'Verdict: REMEDIATION_REQUIRED',
    },
  ]);

  assert.equal(current, 'REMEDIATION_REQUIRED');
});

test('accepts explicit final approval that mentions an earlier remediation', () => {
  const review = [
    'Final verdict: **APPROVE**.',
    'Findings: zero.',
    'Caveats: zero.',
    'The earlier review returned REMEDIATION_REQUIRED and was corrected.',
  ].join('\n');

  assert.equal(classifyReview(review), 'APPROVE');
});

test('rejects conflicting explicit final verdicts', () => {
  const review = [
    'Final verdict: APPROVE',
    'Findings: zero',
    'Caveats: zero',
    'Final verdict: REMEDIATION_REQUIRED',
  ].join('\n');

  assert.equal(classifyReview(review), 'REMEDIATION_REQUIRED');
});

test('accepts Portuguese reviewer handoff with explicit empty findings and caveats', () => {
  assert.equal(
    classifyReview('Status: APPROVE\nAchados: nenhum. Ressalvas: nenhuma.'),
    'APPROVE'
  );
});

test('accepts explicit zero counts stated beside the approval verdict', () => {
  for (const review of [
    'Verdict: APPROVE, zero findings and zero caveats.',
    'Veredito: APPROVE. Zero achados e zero ressalvas.',
    'Verdict: APPROVE. Não encontrei achados nem ressalvas neste escopo.',
  ]) {
    assert.equal(classifyReview(review), 'APPROVE');
  }
});

test('accepts scoped Portuguese finding count beside approval verdict', () => {
  const review =
    '**APPROVE — delta 4.** Achados neste escopo: **0**. Ressalvas: **nenhuma**.';

  assert.equal(classifyReview(review), 'APPROVE');
});

test('parses verdict and count values wrapped in inline code in review fields', () => {
  assert.equal(
    classifyReview('Verdict: `APPROVE`\nFindings: `zero`\nCaveats: `zero`'),
    'APPROVE'
  );
  assert.equal(
    classifyReview('Result: `REMEDIATION_REQUIRED`'),
    'REMEDIATION_REQUIRED'
  );
  assert.equal(
    classifyReview('Veredito: **`APPROVE`**. Zero achados e zero ressalvas.'),
    'APPROVE'
  );
});

test('ignores failure examples mentioned in review body after final approval', () => {
  assert.equal(
    classifyReview(
      'Verdict: APPROVE\nFindings: zero\nCaveats: zero\nParser rejects `Result: FAIL` from validation logs.'
    ),
    'APPROVE'
  );
});

test('ignores result lines inside plain-text examples and fenced code', () => {
  const approval = 'Verdict: APPROVE\nFindings: zero\nCaveats: zero';
  const examples = [
    'Example validation output:\nResult: FAIL',
    'Example validation output:\n\nResult: FAIL',
    '```text\nResult: FAIL\n```',
    '    Result: FAIL',
    '\tResult: FAIL',
  ];

  for (const example of examples) {
    assert.equal(classifyReview(`${approval}\n${example}`), 'APPROVE');
  }
});

test('keeps a real Result failure conflicting with an approval', () => {
  assert.equal(
    classifyReview(
      'Verdict: APPROVE\nFindings: zero\nCaveats: zero\nResult: FAIL'
    ),
    'REMEDIATION_REQUIRED'
  );
  assert.equal(
    classifyReview(
      'Verdict: APPROVE\nFindings: zero\nCaveats: zero\nExample validation output:\nResult: PASS\n\nResult: FAIL'
    ),
    'REMEDIATION_REQUIRED'
  );
});

test('ignores finding and caveat counts inside examples and code', () => {
  const approval = 'Verdict: APPROVE\nFindings: zero\nCaveats: zero';
  const examples = [
    'Example validation output:\nFindings: 1',
    'Example validation output:\nCaveats: 1',
    '```text\nFindings: 1\nCaveats: 1\n```',
    '    Findings: 1\n    Caveats: 1',
    '\tFindings: 1\n\tCaveats: 1',
  ];

  for (const example of examples) {
    assert.equal(classifyReview(`${approval}\n${example}`), 'APPROVE');
  }
});

test('retains a positive finding count after an example boundary', () => {
  assert.equal(
    classifyReview(
      'Verdict: APPROVE\nFindings: zero\nCaveats: zero\nExample output:\nFindings: zero\n\nFindings: 1'
    ),
    'REMEDIATION_REQUIRED'
  );
});

test('does not infer zero counts from qualified or contradictory inline claims', () => {
  for (const review of [
    'Verdict: APPROVE. Zero critical findings and zero code caveats.',
    'Verdict: APPROVE. Zero findings except one unresolved finding; zero caveats.',
    'Verdict: APPROVE. Zero findings and one caveat.',
  ]) {
    assert.equal(classifyReview(review), 'REMEDIATION_REQUIRED');
  }
});

test('groups review rounds by referenced Opus finding and reviewer round', () => {
  const current = aggregateReviewResult([
    {
      name: 'review-luna-hdb003-blocker-r1.md',
      text: [
        'Scope: documentation-only correction for Opus round 2 finding 1 (P2).',
        'Verdict: REMEDIATION_REQUIRED.',
      ].join('\n'),
    },
    {
      name: 'review-luna-hdb003-blocker-r2.md',
      text: [
        'Scope: documentary consistency for Opus round 2 finding 1 (P2) only.',
        'Reviewer round: 2.',
        'Verdict: APPROVE, zero findings and zero caveats.',
      ].join('\n'),
    },
  ]);

  assert.equal(current, 'APPROVE');
});

test('does not treat code-only caveats as zero caveats', () => {
  assert.equal(
    classifyReview('Verdict: APPROVE\nFindings: zero\nCode caveats: zero'),
    'REMEDIATION_REQUIRED'
  );
});

test('does not accept approval without explicit zero findings and caveats', () => {
  assert.equal(
    classifyReview('Verdict: APPROVE. Findings: 1. Caveats: 0.'),
    'REMEDIATION_REQUIRED'
  );
});

test('does not let historical zero findings override a positive current count', () => {
  assert.equal(
    classifyReview(
      'Final verdict: APPROVE\nFindings: 1\nCaveats: 0\nEarlier review: Findings: zero'
    ),
    'REMEDIATION_REQUIRED'
  );
});

test('does not treat zero critical findings as zero findings overall', () => {
  assert.equal(
    classifyReview(
      'Final verdict: APPROVE\nFindings: zero critical findings\nCaveats: zero'
    ),
    'REMEDIATION_REQUIRED'
  );
});

test('finds root reviews and handoff reviewer record, but not other handoff documents', () => {
  const files = reviewFilesForTask(
    [
      { name: 'review-final.md', isFile: () => true },
      { name: 'task.md', isFile: () => true },
      { name: 'handoffs', isFile: () => false },
    ],
    [
      { name: 'reviewer.md', isFile: () => true },
      { name: 'implementer.md', isFile: () => true },
    ]
  );

  assert.deepEqual(files, ['handoffs/reviewer.md', 'review-final.md']);
});

test('uses all roadmap tasks as denominator and reports review coverage separately', () => {
  const progress = summarizeReviewProgress(
    [
      {
        id: 'approved',
        isRoadmapTask: true,
        status: 'in_progress',
        reviews: [
          {
            name: 'review-p2-3-independent-20261021.md',
            text: 'Final verdict: APPROVE\nFindings: zero\nCaveats: zero',
          },
        ],
      },
      {
        id: 'unreviewed',
        isRoadmapTask: true,
        status: 'in_progress',
        reviews: [],
      },
      {
        id: 'nested-approval',
        isRoadmapTask: true,
        status: 'complete',
        reviews: [
          {
            name: 'handoffs/reviewer.md',
            text: 'Status: APPROVE\nAchados: nenhum\nRessalvas: nenhuma',
          },
        ],
      },
      {
        id: 'current',
        isRoadmapTask: false,
        reviews: [
          { name: 'review-current.md', text: 'Verdict: REMEDIATION_REQUIRED' },
        ],
      },
    ],
    'current'
  );

  assert.deepEqual(progress, {
    roadmapTasks: 3,
    reviewedTasks: 2,
    latestSliceApproved: 2,
    completedTasksApproved: 1,
    currentTaskReview: 'REMEDIATION_REQUIRED',
  });
});

test('recognizes H-DATA-003 roadmap with Markdown backticks', () => {
  assert.equal(isHData003Task('- roadmap: `H-DATA-003`, phase 03'), true);
});

test('reads bold task status and labels complete as concluded', () => {
  assert.equal(taskStatus('- **Status:** `complete`'), 'complete');
  assert.equal(taskStatusLabel('complete'), 'Concluída');
});

test('ignores approval-boundary references in a review scope', () => {
  const current = aggregateReviewResult([
    {
      name: 'review-dashboard-initial-20261021.md',
      text: 'Verdict: REMEDIATION_REQUIRED\nScope: dashboard API refresh',
    },
    {
      name: 'review-dashboard-independent-r2-20261021.md',
      text: [
        'Scope: dashboard API refresh. Does not approve H-DATA-003 or H-DB-003.',
        'Final verdict: APPROVE',
        'Findings: zero',
        'Caveats: zero',
      ].join('\n'),
    },
  ]);

  assert.equal(current, 'APPROVE');
});

test('falls back to the task group when Scope only denies broader approval', () => {
  const current = aggregateReviewResult([
    {
      name: 'review-initial-20261021.md',
      text: 'Verdict: REMEDIATION_REQUIRED',
    },
    {
      name: 'review-independent-r2-20261021.md',
      text: [
        'Scope: Does not approve H-DATA-003 or H-DB-003.',
        'Final verdict: APPROVE',
        'Findings: zero',
        'Caveats: zero',
      ].join('\n'),
    },
  ]);

  assert.equal(current, 'APPROVE');
});

test('recognizes explicit zero counts in qualified caveat fields', () => {
  const result = classifyReview(
    [
      'Final verdict: APPROVE',
      'Findings: zero',
      'Ressalvas abertas: zero',
    ].join('\n')
  );

  assert.equal(result, 'APPROVE');
});

test('groups free-text scopes by stable review name and ignores roadmap exclusions', () => {
  const result = aggregateReviewResult([
    {
      name: 'review-dashboard-initial-20261021.md',
      text: 'Verdict: REMEDIATION_REQUIRED\nScope: dashboard API refresh',
    },
    {
      name: 'review-dashboard-independent-r2-20261021.md',
      text: [
        'Scope: dashboard API refresh. Does not approve H-DATA-003 or H-DB-003.',
        'Final verdict: APPROVE',
        'Findings: zero',
        'Ressalvas abertas: zero',
      ].join('\n'),
    },
  ]);

  assert.equal(result, 'APPROVE');
});

test('groups A3 rounds under their finding label instead of changing prose scope', () => {
  const result = aggregateReviewResult([
    {
      name: 'review-a3-independent-20261021-r1.md',
      text: 'Scope: A3 only — review-scope grouping\nVerdict: REMEDIATION_REQUIRED\nFindings: 1\nCaveats: 0',
    },
    {
      name: 'review-a3-independent-20261021-r2.md',
      text: [
        'Scope: A3 only — review-scope grouping and live panel evidence.',
        'Final verdict: APPROVE',
        'Findings: zero',
        'Caveats: zero',
      ].join('\n'),
    },
  ]);

  assert.equal(result, 'APPROVE');
});

test('explicit Scope IDs override conflicting finding IDs in filenames', () => {
  const reviews = [
    {
      name: 'review-P2-3-independent-20261022-r1.md',
      text: [
        'Scope: P2-3 only',
        'Verdict: REMEDIATION_REQUIRED',
        'Findings: 1',
        'Caveats: 0',
      ].join('\n'),
    },
    {
      name: 'review-P2-3-independent-20261022-r2.md',
      text: [
        'Scope: P2-2 only — Does not approve P2-3.',
        'Final verdict: APPROVE',
        'Findings: zero',
        'Caveats: zero',
      ].join('\n'),
    },
  ];

  assert.equal(aggregateReviewResult(reviews), 'REMEDIATION_REQUIRED');
});

test('parses A1-A5 labels and keeps excluded filename scopes unresolved', () => {
  for (let number = 1; number <= 5; number += 1) {
    const declaredScope = `A${number}`;
    const filenameScope = `A${(number % 5) + 1}`;
    const reviews = [
      {
        name: `review-${filenameScope}-independent-20261022-r1.md`,
        text: [
          `Scope: ${filenameScope} only`,
          'Verdict: REMEDIATION_REQUIRED',
          'Findings: 1',
          'Caveats: 0',
        ].join('\n'),
      },
      {
        name: `review-${filenameScope}-independent-20261022-r2.md`,
        text: [
          `Scope: ${declaredScope} only — Does not approve ${filenameScope}.`,
          'Final verdict: APPROVE',
          'Findings: zero',
          'Caveats: zero',
        ].join('\n'),
      },
    ];

    assert.equal(
      aggregateReviewResult(reviews),
      'REMEDIATION_REQUIRED',
      `${declaredScope} must not approve excluded filename scope ${filenameScope}`
    );
  }
});

test('does not count the provenance index as a reviewer report', () => {
  const files = reviewFilesForTask(
    [
      { name: 'review-provenance-index.md', isFile: () => true },
      { name: 'review-final.md', isFile: () => true },
    ],
    []
  );

  assert.deepEqual(files, ['review-final.md']);
});

test('orders same-round reviews by all six timestamp digits', () => {
  const result = aggregateReviewResult([
    {
      name: 'review-p2-4-independent-20261022-201521-r1.md',
      text: [
        'Scope: P2-4 only',
        'Verdict: REMEDIATION_REQUIRED',
        'Findings: 1',
        'Caveats: 0',
      ].join('\n'),
    },
    {
      name: 'review-p2-4-independent-20261022-201559-r1.md',
      text: [
        'Scope: P2-4 only',
        'Final verdict: APPROVE',
        'Findings: zero',
        'Caveats: zero',
      ].join('\n'),
    },
  ]);

  assert.equal(result, 'APPROVE');
});

test('recognizes accented Portuguese full-tree scope', () => {
  const result = aggregateReviewResult([
    {
      name: 'review-opus-working-tree-20261022-080000.md',
      text: [
        'Scope: working tree',
        'Verdict: REMEDIATION_REQUIRED',
        'Findings: 1',
        'Caveats: 0',
      ].join('\n'),
    },
    {
      name: 'review-opus-working-tree-independent-20261022-080001-r1.md',
      text: [
        'Scope: árvore de trabalho, A1–A5',
        'Final verdict: APPROVE',
        'Findings: zero',
        'Caveats: zero',
      ].join('\n'),
    },
  ]);

  assert.equal(result, 'APPROVE');
});
