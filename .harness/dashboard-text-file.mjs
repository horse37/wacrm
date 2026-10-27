import { readFile } from 'node:fs/promises';

export async function readDashboardText(
  path,
  readFileImplementation = readFile
) {
  return readFileImplementation(path, 'utf8');
}
