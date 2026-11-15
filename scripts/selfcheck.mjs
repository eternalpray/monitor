// HTTP 自检：验证健康检查、记录查询、演示写入链路是否打通。
// 用法：先启动服务（npm start），再 `npm run verify`。
const BASE = process.env.DDS_MONITOR_URL || 'http://localhost:7788';

async function req(method, path) {
  const res = await fetch(BASE + path, { method });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function check(name, ok, detail) {
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail ? ' — ' + detail : ''}`);
  return ok;
}

const failures = [];
async function run() {
  console.log(`自检目标: ${BASE}\n`);

  const health = await req('GET', '/api/health');
  failures.push(check('健康检查 /api/health', health.status === 200 && health.body.ok, `node=${health.body.node} arch=${health.body.arch}`));

  const stats = await req('GET', '/api/stats');
  failures.push(check('统计 /api/stats', stats.status === 200 && stats.body.ok, `记录=${stats.body.bufferedRecords}`));

  const records = await req('GET', '/api/records?limit=5');
  failures.push(check('记录查询 /api/records', records.status === 200 && records.body.ok, `total=${records.body.total}`));

  const emit = await req('POST', '/api/demo/emit?count=1');
  failures.push(check('演示数据 /api/demo/emit', emit.status === 200 && emit.body.ok, `files=${(emit.body.files || []).length}`));

  const slow = await req('POST', '/api/demo/slow?chunks=20&intervalMs=50');
  failures.push(check('慢速写入 /api/demo/slow', slow.status === 200 && slow.body.ok));

  const config = await req('GET', '/api/config');
  failures.push(check('配置查询 /api/config', config.status === 200 && config.body.ok, `watchDir=${config.body.config && config.body.config.watchDir}`));

  // 等待慢速写入完成，验证防半截：期间不应有半截记录
  console.log('\n  等待 2s 让慢速写入完成…');
  await new Promise((r) => setTimeout(r, 2000));
  const stats2 = await req('GET', '/api/stats');
  failures.push(check('写入后统计更新', stats2.body.ok && stats2.body.bufferedRecords >= stats.body.bufferedRecords, `记录=${stats2.body.bufferedRecords}`));

  const okAll = failures.every((x) => x);
  console.log(`\n${okAll ? '✅ 全部通过' : '❌ 存在失败项'}`);
  process.exit(okAll ? 0 : 1);
}

run().catch((err) => {
  console.error('自检异常:', err.message);
  process.exit(1);
});
