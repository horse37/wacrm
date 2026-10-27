function hasInlineZeroCountInVerdict(text, labels) {
  const verdictLine = String(text)
    .split(/\r?\n/)
    .find((line) => /\bAPPROVE\b/i.test(line));
  if (!verdictLine) return false;

  const countLabels = labels.includes('caveat')
    ? `(?:(?:open|abertas?)\\s+)?(?:${labels})(?:\\s+(?:open|abertas?))?`
    : `(?:${labels})(?:\\s+(?:in (?:the )?scope|neste escopo))?`;
  const zeroCount = new RegExp(`\\b(?:zero|0)\\s+${countLabels}\\b`, 'i');
  const noCount = new RegExp(`\\b(?:no|none)\\s+${countLabels}\\b`, 'i');
  const positiveCount = new RegExp(
    `\\b(?:[1-9]\\d*|one|two|three|four|five|um|uma|dois|duas|tr[eê]s)\\s+${countLabels}\\b`,
    'i'
  );
  const qualifiedZero = new RegExp(
    `\\b(?:zero|0|no|none|nenhum|nenhuma|sem)\\s+${countLabels}\\s+(?:except|but|unless|however|although|exceto|mas|por[eé]m|ainda|remaining|unresolved|pending)\\b`,
    'i'
  );
  const portugueseNo = labels.includes('achado')
    ? /\b(?:nenhum|nenhuma|sem)\s+achados?\b|\b(?:n[aã]o)\s+encontrei\s+achados?\b/i
    : /\b(?:nenhuma|sem)\s+ressalvas?(?:\s+abertas?)?\b|\b(?:n[aã]o)\s+encontrei\s+ressalvas?(?:\s+abertas?)?\b|\b(?:n[aã]o)\s+encontrei\s+achados?\s+nem\s+ressalvas?(?:\s+abertas?)?\b/i;

  if (positiveCount.test(verdictLine) || qualifiedZero.test(verdictLine)) {
    return false;
  }
  return (
    zeroCount.test(verdictLine) ||
    noCount.test(verdictLine) ||
    portugueseNo.test(verdictLine)
  );
}

function hasOnlyExplicitZeroCount(text, labels) {
  const countLabels = labels.includes('caveat')
    ? `(?:(?:open|abertas?)\\s+)?(?:${labels})(?:\\s+(?:open|abertas?))?`
    : `(?:${labels})(?:\\s+(?:in (?:the )?scope|neste escopo))?`;
  const fieldPattern = new RegExp(
    `(?<!\\bcode\\s)\\b${countLabels}\\s*:\\s*([^\\r\\n.;]*)(?=[.;\\r\\n]|$)`,
    'gi'
  );
  const fields = [...String(text).matchAll(fieldPattern)];
  if (fields.length === 0) return hasInlineZeroCountInVerdict(text, labels);

  return fields.every((field) => {
    const value = field[1]
      .trim()
      .replace(/^[`*_ ]+|[`*_ ]+$/g, '')
      .replace(/[.!?;,]+$/g, '')
      .trim()
      .toLowerCase();
    return ['zero', '0', 'none', 'no', 'nenhum', 'nenhuma'].includes(value);
  });
}

function reviewTextWithoutExamples(text) {
  const verdictLines = [];
  let fence = null;
  let inExample = false;
  let exampleHasContent = false;

  for (const line of String(text).split(/\r?\n/)) {
    const fenceMarker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMarker) {
      const marker = fenceMarker[1];
      if (!fence) {
        fence = { character: marker[0], length: marker.length };
      } else if (
        marker[0] === fence.character &&
        marker.length >= fence.length
      ) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;
    if (/^(?: {4,}|\t)/.test(line)) continue;

    const reviewField =
      /^\s{0,3}(?:[-*]\s*)?[`*_ ]*\b(?:(?:final|overall)\s+)?(?:verdict|result|veredito|resultado|status|estado|findings?|achados?|(?:(?:open|abertas?)\s+)?caveats?|ressalvas?(?:\s+abertas?)?)\s*:/i.test(
        line
      );
    const lineWithoutCode = reviewField
      ? line.replace(/(`+)(.*?)\1/g, '$2')
      : line.replace(/(`+).*?\1/g, ' ');
    if (
      /^\s{0,3}(?:#{1,6}\s*)?(?:example|sample|exemplo|validation output|output example|sa[ií]da de exemplo|sa[ií]da de valida[cç][aã]o)\b.*$/i.test(
        lineWithoutCode
      )
    ) {
      inExample = true;
      exampleHasContent = false;
      continue;
    }
    if (inExample) {
      if (!lineWithoutCode.trim() && !exampleHasContent) continue;
      if (!lineWithoutCode.trim()) {
        inExample = false;
        exampleHasContent = false;
        verdictLines.push(lineWithoutCode);
        continue;
      }
      exampleHasContent = true;
      continue;
    }

    verdictLines.push(lineWithoutCode);
  }

  return verdictLines.join('\n');
}

function explicitVerdict(text) {
  const normalized = String(text);
  const fields = [
    ...normalized.matchAll(
      /^\s*(?:[-*]\s*)?[`*_ ]*\b(?:(final)\s+)?(?:verdict|result|veredito|resultado|status|estado)\s*:\s*[`*_ ]*(APPROVE|REMEDIATION[_ -]REQUIRED|REJECT(?:ED)?|FAIL|CHANGES[_ -]REQUESTED)\b/gim
    ),
  ];
  const finalFields = fields.filter((match) => match[1]);
  const selectedFields = finalFields.length > 0 ? finalFields : fields;
  const verdicts = new Set(
    selectedFields.map((field) => field[2].toUpperCase().replace(/[ -]/g, '_'))
  );
  if (verdicts.size > 1) return 'CONFLICT';
  if (verdicts.size === 1) return [...verdicts][0];

  const standalone = normalized.match(
    /^\s*(?:[-*]\s*)?[`*_ ]*(APPROVE|REMEDIATION[_ -]REQUIRED|REJECT(?:ED)?|FAIL|CHANGES[_ -]REQUESTED)\b/im
  );
  return standalone?.[1]?.toUpperCase().replace(/[ -]/g, '_') ?? '';
}

export function classifyReview(text) {
  const reviewText = reviewTextWithoutExamples(text);
  const verdict = explicitVerdict(reviewText);
  if (
    verdict === 'APPROVE' &&
    hasOnlyExplicitZeroCount(reviewText, 'findings?|achados?') &&
    hasOnlyExplicitZeroCount(reviewText, 'caveats?|ressalvas?')
  ) {
    return 'APPROVE';
  }
  if (verdict) return 'REMEDIATION_REQUIRED';
  return 'pendente';
}

export function reviewFilesForTask(rootEntries, handoffEntries) {
  const rootReviews = rootEntries
    .filter(
      (entry) =>
        entry.isFile() &&
        /^review.*\.md$/i.test(entry.name) &&
        !/^review-provenance-index\.md$/i.test(entry.name)
    )
    .map((entry) => entry.name);
  const handoffReviews = handoffEntries
    .filter((entry) => entry.isFile() && /^reviewer\.md$/i.test(entry.name))
    .map((entry) => `handoffs/${entry.name}`);

  return [...rootReviews, ...handoffReviews].sort((a, b) => a.localeCompare(b));
}

function isTaskWideReviewScope(value) {
  const text = String(value ?? '').trim();
  return (
    /(?:^|[^\p{L}])(?:working[ -]tree|(?:full|whole|entire|complete)[ -]tree|(?:full|whole|entire|complete) task|task[ -]wide|whole scope|full scope|entire scope|árvore de trabalho|tarefa completa|escopo integral|revis[aã]o integral)\b/iu.test(
      text
    ) || /^(?:the\s+)?(?:task|tarefa)(?:\s*[,;:.]|$)/i.test(text)
  );
}

function reviewScopes(review) {
  const name = String(review.name ?? '');
  const text = String(review.text ?? '');
  const filenameScopes = [
    ...name.matchAll(/(?:^|[\\/_-])(P[0-3]-\d+|A\d+)(?=$|[\\/_.-])/gi),
  ].map((match) => match[1].toUpperCase());
  const declaredScope = text.match(
    /^\s*(?:[-*]\s*)?(?:scope|escopo)\s*:\s*(.+)$/im
  );

  if (declaredScope) {
    if (isTaskWideReviewScope(declaredScope[1])) return ['task'];

    const scopeText = declaredScope[1]
      .replace(
        /(?:\b(?:(?:does|do|did)\s+not|(?:does|do|did)n['’]t)\s+(?:approve|cover|include|review|assess|validate)\b|\b(?:not approved|out of scope|remain(?:s)? unapproved|n[aã]o\s+(?:aprova|cobre)|fora de escopo)\b)[\s\S]*$/i,
        ''
      )
      .replace(/[.;,:!?]+\s*$/, '')
      .trim();
    const declaredIds = [
      ...scopeText.matchAll(/\b(?:P[0-3]-\d+|A[1-5])\b/gi),
    ].map((match) => match[0].toUpperCase());
    if (declaredIds.length > 0) {
      return [...new Set(declaredIds)];
    }

    const opusFindings = [
      ...scopeText.matchAll(/\bopus\s+round\s+(\d+)\s+finding\s+(\d+)\b/gi),
    ].map((match) => 'OPUS-R' + match[1] + '-F' + match[2]);
    if (opusFindings.length > 0) return [...new Set(opusFindings)];
  }

  if (isTaskWideReviewScope(name)) return ['task'];

  if (filenameScopes.length > 0) return [...new Set(filenameScopes)];

  const basename = name.split(/[\\/]/).pop() ?? '';
  const filenameScope = basename
    .replace(/^review-/i, '')
    .replace(/\.md$/i, '')
    .replace(
      /(?:^|-)(?:initial|first|inicial|independent|re-review|final|remediation|correction|corrected|post-remediation|post-implementation|r\d+|20\d{6})(?:-|$).*$/i,
      ''
    )
    .replace(/-+$/g, '');

  return filenameScope ? [filenameScope.toLowerCase()] : ['task'];
}

function reviewOrder(review) {
  const name = String(review.name ?? '');
  const text = String(review.text ?? '');
  const roundMatch =
    name.match(/(?:^|[-_])r(\d+)(?=[-_.]|$)/i) ??
    text.match(
      /\b(?:reviewer|review|revisor|revis[aã]o)\s+(?:round|rodada)\s*[:#-]?\s*(\d+)\b/i
    );
  const dateMatch = name.match(/(20\d{6})(?:[-_T]?(\d{6}|\d{4}))?/);
  const lowerName = name.toLowerCase();
  let phase = 1;
  if (
    /(?:post[-_]remediation|post[-_]implementation|independent|re[-_]review|final)/.test(
      lowerName
    )
  ) {
    phase = 3;
  } else if (/(?:remediation|correction|corrected)/.test(lowerName)) {
    phase = 2;
  } else if (/(?:initial|first|inicial)/.test(lowerName)) {
    phase = 0;
  }

  return [
    Number(dateMatch?.[1] ?? 0),
    Number(dateMatch?.[2]?.padEnd(6, '0') ?? 0),
    roundMatch ? 1 : 0,
    Number(roundMatch?.[1] ?? 0),
    phase,
  ];
}

function compareOrder(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function resolveReviewScopes(reviews) {
  const grouped = new Map();
  for (const review of reviews) {
    for (const scope of reviewScopes(review)) {
      const group = grouped.get(scope) ?? [];
      group.push({
        result: classifyReview(review.text),
        order: reviewOrder(review),
      });
      grouped.set(scope, group);
    }
  }

  return [...grouped.entries()].map(([scope, records]) => {
    const newestOrder = records.reduce(
      (newest, record) =>
        compareOrder(record.order, newest) > 0 ? record.order : newest,
      records[0].order
    );
    const newest = records.filter(
      (record) => compareOrder(record.order, newestOrder) === 0
    );
    const result = newest.every((record) => record.result === 'APPROVE')
      ? 'APPROVE'
      : newest.some((record) => record.result === 'REMEDIATION_REQUIRED')
        ? 'REMEDIATION_REQUIRED'
        : 'pendente';
    return { scope, result };
  });
}

export function aggregateReviewResult(reviews) {
  if (reviews.length === 0) return 'pendente';
  const scopes = resolveReviewScopes(reviews);
  if (scopes.every((scope) => scope.result === 'APPROVE')) return 'APPROVE';
  if (scopes.some((scope) => scope.result === 'REMEDIATION_REQUIRED')) {
    return 'REMEDIATION_REQUIRED';
  }
  return 'pendente';
}

export function summarizeReviewProgress(tasks, currentTaskId = '') {
  let roadmapTasks = 0;
  let reviewedTasks = 0;
  let latestSliceApproved = 0;
  let completedTasksApproved = 0;
  let currentTaskReview = 'pendente';

  for (const task of tasks) {
    if (!task.isRoadmapTask && task.id !== currentTaskId) continue;
    const reviews = Array.isArray(task.reviews) ? task.reviews : [];
    const result = aggregateReviewResult(reviews);

    if (task.isRoadmapTask) {
      roadmapTasks += 1;
      if (reviews.length > 0) reviewedTasks += 1;
      if (reviews.length > 0 && result === 'APPROVE') {
        latestSliceApproved += 1;
        if (['complete', 'completed'].includes(task.status)) {
          completedTasksApproved += 1;
        }
      }
    }
    if (task.id === currentTaskId) currentTaskReview = result;
  }

  return {
    roadmapTasks,
    reviewedTasks,
    latestSliceApproved,
    completedTasksApproved,
    currentTaskReview,
  };
}

export function isHData003Task(text) {
  return /\broadmap:\s*[`*_]*H-DATA-003\b/im.test(String(text));
}

export function taskStatus(text) {
  return (
    String(text).match(
      /^\s*-\s*.*?\bstatus\b.*?:\s*[`*_ ]*([a-z_-]+)/im
    )?.[1] ?? ''
  ).toLowerCase();
}

export function taskStatusLabel(value) {
  return (
    {
      in_progress: 'Em andamento',
      complete: 'Concluída',
      completed: 'Concluída',
      blocked: 'Bloqueada',
      paused: 'Pausada',
    }[value] ?? 'Não informado'
  );
}
