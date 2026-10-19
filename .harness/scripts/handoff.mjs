#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const [,, taskId, agent, ...rest] = process.argv;
if (!taskId || !agent) {
  console.error("usage: node .harness/scripts/handoff.mjs <taskId> <agent> <message>");
  process.exit(1);
}
const msg = rest.join(" ").trim() || "updated";
const dir = path.join(".harness", "tasks", taskId, "handoffs");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${agent}.md`);
const content = `# Handoff

- agent: ${agent}
- task: ${taskId}

## Goal

## Files

## Result
${msg}

## Risk

## Next
`;
fs.writeFileSync(file, content);
console.log(file);
