import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { classifyReview } from './dashboard-review-progress.mjs';
import { classifyValidationResult } from './dashboard-validation-result.mjs';

export async function collectValidationFiles(taskDirectory, dependencies = {}) {
  const listDirectory = dependencies.readdir ?? readdir;
  const getFileMetadata = dependencies.stat ?? stat;
  const readFileContents = dependencies.readFile ?? readFile;
  const entries = await listDirectory(taskDirectory, { withFileTypes: true });
  const files = entries.filter(
    (entry) =>
      entry.isFile() &&
      /^(validation|tdd|review).*\.(?:log|md)$/i.test(entry.name)
  );
  const rows = await Promise.all(
    files.map(async (entry) => {
      const path = join(taskDirectory, entry.name);
      const metadata = await getFileMetadata(path);
      const content = await readFileContents(path, 'utf8');
      const isReview = /^review/i.test(entry.name);
      let result = 'evidência registrada';
      if (isReview) {
        const reviewResult = classifyReview(content);
        if (reviewResult === 'APPROVE') result = 'APPROVE';
        else if (reviewResult === 'REMEDIATION_REQUIRED') {
          result = 'remediação requerida';
        }
      } else result = classifyValidationResult(content);
      return {
        name: entry.name,
        result,
        updatedAt: metadata.mtime.toISOString(),
      };
    })
  );
  return rows
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 10);
}
