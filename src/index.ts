import { createProgram } from './cli.js';

const program = createProgram();

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
