'use strict';

// 结构化日志：统一到 stderr，便于 `npm start` 前台观察与 systemd/容器采集。
// 级别：debug / info / warn / error

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let currentLevel = 'info';

function setLevel(level) {
  if (LEVELS[level] != null) currentLevel = level;
}

function fmt(ts) {
  return new Date(ts).toISOString();
}

function emit(level, message, extra) {
  if (LEVELS[level] < LEVELS[currentLevel]) return;
  const rec = { t: fmt(Date.now()), level, msg: message };
  if (extra && typeof extra === 'object') Object.assign(rec, extra);
  const line = JSON.stringify(rec);
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

module.exports = {
  setLevel,
  debug: (m, e) => emit('debug', m, e),
  info: (m, e) => emit('info', m, e),
  warn: (m, e) => emit('warn', m, e),
  error: (m, e) => emit('error', m, e),
};
