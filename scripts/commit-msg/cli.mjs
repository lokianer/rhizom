// Entry point of the commit-msg git hook, installed by simple-git-hooks as
//   node ./scripts/commit-msg/cli.mjs "$1"
// Git passes the path of the file holding the proposed message; a non-zero exit aborts the commit.
import { readFileSync } from 'node:fs';

import { checkCommitMessage } from './check.mjs';

const messageFile = process.argv[2];
if (!messageFile) {
  console.error('commit-msg: expected the path of the commit message file as the first argument');
  process.exit(2);
}

let message;
try {
  message = readFileSync(messageFile, 'utf8');
} catch (error) {
  console.error(
    `commit-msg: cannot read ${messageFile}: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(2);
}

const result = checkCommitMessage(message);
if (!result.ok) {
  console.error(
    ['commit-msg: commit rejected', ...result.errors.map((error) => `  - ${error}`)].join('\n'),
  );
  process.exit(1);
}
