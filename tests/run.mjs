/**
 * Entry point for `npm test`.
 *
 * Node sizes its test-runner pool at one worker process per core. On Android that is fatal: every
 * worker compiles the Rapier WASM into its own memory and a single test file peaks around 250 MB,
 * so a handful of workers exhaust a phone's RAM and Android's low-memory killer takes out the whole
 * Termux app - every session, not just the test run.
 *
 * So Android runs one file at a time, and every other platform is left with Node's own default.
 * The flag is omitted rather than passed as a number so that "not Android" means stock behaviour on
 * any Node version.
 */
import { spawn } from 'node:child_process';

const extra = process.argv.slice(2);
// Naming test paths replaces the default glob instead of adding to it, so `npm test -- tests/x.test.mjs`
// runs just that file rather than the whole suite and then that file again. Flags are always appended.
const targets = extra.some((arg) => !arg.startsWith('-')) ? [] : ['tests/**/*.test.mjs'];

const args = [
  '--import', './tests/support/register.mjs',
  '--test',
  ...(process.platform === 'android' ? ['--test-concurrency=1'] : []),
  ...targets,
  ...extra
];

const runner = spawn(process.execPath, args, { stdio: 'inherit' });

runner.on('exit', (code) => process.exit(code ?? 1));
