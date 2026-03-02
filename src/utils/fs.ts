import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/**
 * Process a JSONL file line by line using Node.js streams.
 * Memory-efficient for large files.
 */
export async function processJSONLFile(
  filePath: string,
  processLine: (parsed: unknown) => void,
): Promise<void> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed);
      processLine(parsed);
    } catch {
      // Skip invalid JSON lines
    }
  }
}
