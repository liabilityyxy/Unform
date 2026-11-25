import { spawn } from 'node:child_process';

const children = [
  spawn('node', ['--import', 'tsx', 'server/index.ts'], { stdio: 'inherit' }),
  spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { stdio: 'inherit' }),
];
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  children.forEach(child => child.kill('SIGTERM'));
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
children.forEach(child => child.on('exit', code => { if (!closing) stop(code || 0); }));
