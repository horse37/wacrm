const ANSI_ESCAPE = /\u001B\[[0-?]*[ -/]*[@-~]/g;

export function classifyValidationResult(content) {
  const normalized = String(content).replace(ANSI_ESCAPE, '');

  if (
    /^\s*(?:(?:Overall|Final)\s+result|Result):\s*(?:FAILURE|FAIL)\b/im.test(
      normalized
    ) ||
    /^\s*Exit code:\s*[1-9]\d*\b/im.test(normalized) ||
    /\bExit\s+status\s*:?\s*[1-9]\d*\b/i.test(normalized) ||
    /\bAssertionError\b/i.test(normalized) ||
    /^\s*FAIL(?:URE)?:/im.test(normalized) ||
    /^\s*FAIL\s+\S/im.test(normalized) ||
    /^\s*(?:ℹ|#)\s*fail\s+[1-9]\d*\b/im.test(normalized) ||
    /^\s*not ok\b/im.test(normalized) ||
    /^\s*Errors\s+[1-9]\d*\s+error(?:s|\(s\))?(?=\s|$)/im.test(normalized) ||
    /^\s*(?:Test Files|Tests)\s+\d+\s+failed\b/im.test(normalized)
  ) {
    return 'FAIL';
  }

  if (
    /^\s*(?:(?:Overall|Final) result|Result):\s*(?:SUCCESS|PASS)\b/im.test(
      normalized
    ) ||
    /^\s*Exit code:\s*0\b/im.test(normalized) ||
    /^\s*SUCCESS\b/im.test(normalized) ||
    /^\s*(?:Test Files|Tests)\s+\d+\s+passed\b/im.test(normalized)
  ) {
    return 'PASS';
  }

  return 'evidência registrada';
}
