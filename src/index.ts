import { CommanderError } from 'commander';
import { createProgram } from './cli.js';

const program = createProgram();
program.exitOverride();

program.parseAsync(process.argv).catch((err) => {
  if (err instanceof CommanderError) {
    if (err.code === 'commander.version' || err.code.includes('help')) {
      process.exit(0);
    }

    const usageErrorCodes = new Set([
      'commander.unknownOption',
      'commander.conflictingOption',
      'commander.invalidArgument',
      'commander.missingArgument',
      'commander.optionMissingArgument',
      'commander.excessArguments',
      'commander.unknownCommand',
    ]);

    if (usageErrorCodes.has(err.code)) {
      process.exit(2);
    }

    process.exit(err.exitCode > 0 ? err.exitCode : 1);
  }

  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
