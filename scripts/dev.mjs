// 开发模式：并行启动后端 (Express:7788) 与前端 (Vite:5173)。
// Vite 已把 /api 代理到 7788，两个进程互不干扰。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const children = [
  { name: 'server', cmd: process.execPath, args: [path.join(root, 'server', 'index.js')] },
  { name: 'web', cmd: npm, args: ['run', 'dev', '-w', 'web'] },
];

for (const c of children) {
  const p = spawn(c.cmd, c.args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  p.on('exit', (code) => {
    console.log(`[${c.name}] 退出，code=${code}`);
    process.exit(code ?? 0);
  });
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
