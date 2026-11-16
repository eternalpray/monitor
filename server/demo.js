'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function pad(n) { return String(n).padStart(2, '0'); }

function fmtLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtIso(d) {
  return d.toISOString();
}

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// ---------------------------------------------------------------------------
// PRD 附录 C 风格的演示数据集：多域 + 多参与者 + 多 IP + 故意不兼容的 QoS 配对。
// domain 0 与附录 C 完全一致（TC-23 / TC-28 / TC-29 / TC-30 的基准）。
// ---------------------------------------------------------------------------

// 每个域由若干参与者与若干主题构成。
// 参与者：{ guid, name, ip, host, pid, qos }
// 主题：{ name, type, partition, qos, writers:[参与者下标], readers:[参与者下标] }
// 端点 QoS 可覆盖参与者 QoS（用于构造故意不兼容的配对）。
const DOMAIN_SPECS = [
  {
    domainId: '0',
    nodeId: 'collector-01',
    participants: [
      { guid: '01.0f.aa.11.00.00.01|0.0.1', name: 'PubVehicle', ip: '192.168.1.11', host: 'ecu-01', pid: '2314', qos: { reliability: 'RELIABLE', durability: 'TRANSIENT_LOCAL', deadline: 100, liveliness: 'AUTOMATIC', ownership: 'SHARED', partition: ['veh'] } },
      { guid: '01.0f.aa.17.00.00.01|0.0.2', name: 'SubMonitor', ip: '192.168.1.23', host: 'hmi-01', pid: '881', qos: { reliability: 'RELIABLE', durability: 'TRANSIENT_LOCAL', deadline: 50, liveliness: 'AUTOMATIC', ownership: 'SHARED', partition: ['veh'] } },
      { guid: '01.0f.aa.18.00.00.01|0.0.3', name: 'Logger', ip: '192.168.1.24', host: 'log-01', pid: '902', qos: { reliability: 'BEST_EFFORT', durability: 'VOLATILE', liveliness: 'AUTOMATIC', ownership: 'SHARED', partition: ['veh'] } },
    ],
    topics: [
      {
        name: 'rt/vehicle/pose', type: 'geometry::Pose', partition: 'veh',
        qos: { reliability: 'RELIABLE', durability: 'TRANSIENT_LOCAL', deadline: 100 },
        writers: [
          { participant: 0, guid: '01.0f.aa.11.00.00.01|0.0.1.w1', qos: { reliability: 'RELIABLE', durability: 'TRANSIENT_LOCAL', deadline: 100, liveliness: 'AUTOMATIC', ownership: 'SHARED', partition: ['veh'] }, sampleRate: 50.2 },
        ],
        readers: [
          { participant: 1, guid: '01.0f.aa.17.00.00.01|0.0.2.r1', qos: { reliability: 'RELIABLE', durability: 'TRANSIENT_LOCAL', deadline: 50, liveliness: 'AUTOMATIC', ownership: 'SHARED', partition: ['veh'] } },
          { participant: 2, guid: '01.0f.aa.18.00.00.01|0.0.3.r1', qos: { reliability: 'BEST_EFFORT', durability: 'VOLATILE', deadline: 50, liveliness: 'AUTOMATIC', ownership: 'SHARED', partition: ['veh'] } },
        ],
      },
      { name: 'rt/chassis/status', type: 'ChassisStatus', partition: 'veh', qos: {}, writers: [], readers: [] },
    ],
  },
  {
    domainId: '1',
    nodeId: 'collector-01',
    participants: [
      { guid: '01.0f.bb.11.00.00.01|0.1.1', name: 'Planner', ip: '10.0.0.11', host: 'planner-01', pid: '1101', qos: { reliability: 'RELIABLE', durability: 'VOLATILE', liveliness: 'AUTOMATIC', ownership: 'SHARED', partition: ['plan'] } },
      { guid: '01.0f.bb.17.00.00.01|0.1.2', name: 'Executor', ip: '10.0.0.22', host: 'exec-01', pid: '2202', qos: { reliability: 'BEST_EFFORT', durability: 'VOLATILE', liveliness: 'AUTOMATIC', ownership: 'SHARED', partition: ['plan'] } },
    ],
    topics: [
      {
        name: 'plan/trajectory', type: 'Trajectory', partition: 'plan',
        qos: {},
        writers: [
          { participant: 0, guid: '01.0f.bb.11.00.00.01|0.1.1.w1', qos: { reliability: 'RELIABLE', durability: 'VOLATILE', liveliness: 'AUTOMATIC', ownership: 'SHARED', partition: ['plan'] }, sampleRate: 20.0 },
        ],
        readers: [
          // 故意不兼容：订阅端要求 RELIABLE，发布端 BEST_EFFORT
          { participant: 1, guid: '01.0f.bb.17.00.00.01|0.1.2.r1', qos: { reliability: 'RELIABLE', durability: 'VOLATILE', liveliness: 'AUTOMATIC', ownership: 'SHARED', partition: ['plan'] } },
        ],
      },
    ],
  },
  {
    domainId: '2',
    nodeId: 'collector-02',
    participants: [
      { guid: '01.0f.cc.11.00.00.01|0.2.1', name: 'Sensor', ip: '172.16.0.10', host: 'sensor-01', pid: '3101', qos: { reliability: 'BEST_EFFORT', durability: 'VOLATILE', liveliness: 'AUTOMATIC', ownership: 'SHARED', partition: ['raw'] } },
      { guid: '01.0f.cc.17.00.00.01|0.2.2', name: 'Fusion', ip: '172.16.0.20', host: 'fusion-01', pid: '3202', qos: { reliability: 'BEST_EFFORT', durability: 'VOLATILE', liveliness: 'AUTOMATIC', ownership: 'SHARED', partition: ['raw'] } },
    ],
    topics: [
      {
        name: 'raw/imu', type: 'ImuSample', partition: 'raw',
        qos: {},
        writers: [
          { participant: 0, guid: '01.0f.cc.11.00.00.01|0.2.1.w1', qos: { reliability: 'BEST_EFFORT', durability: 'VOLATILE', liveliness: 'AUTOMATIC', ownership: 'SHARED', partition: ['raw'] }, sampleRate: 100.0 },
        ],
        readers: [
          { participant: 1, guid: '01.0f.cc.17.00.00.01|0.2.2.r1', qos: { reliability: 'BEST_EFFORT', durability: 'VOLATILE', liveliness: 'AUTOMATIC', ownership: 'SHARED', partition: ['raw'] } },
        ],
      },
    ],
  },
];

function qosAttrs(qos) {
  if (!qos) return '';
  const parts = [];
  if (qos.reliability) parts.push(`reliability="${qos.reliability}"`);
  if (qos.durability) parts.push(`durability="${qos.durability}"`);
  if (qos.deadline != null) parts.push(`deadlineMs="${qos.deadline}"`);
  if (qos.liveliness) parts.push(`liveliness="${qos.liveliness}"`);
  if (qos.ownership) parts.push(`ownership="${qos.ownership}"`);
  if (qos.partition) parts.push(`partition="${Array.isArray(qos.partition) ? qos.partition.join(',') : qos.partition}"`);
  return parts.join(' ');
}

function buildDomainXml(spec, now) {
  const participantsXml = spec.participants.map((p) => {
    const a = qosAttrs(p.qos);
    return `    <participant guid="${p.guid}" name="${p.name}" ip="${p.ip}" host="${p.host}" pid="${p.pid}" status="ALIVE">\n` +
      `      <qos ${a}/>\n` +
      `    </participant>`;
  }).join('\n');

  const topicsXml = spec.topics.map((t) => {
    const writersXml = t.writers.map((w) => {
      const p = spec.participants[w.participant];
      return `        <writer guid="${w.guid}" participantGuid="${p.guid}" ip="${p.ip}" status="ALIVE">\n` +
        `          <qos ${qosAttrs(w.qos)}/>\n` +
        `          <sampleRate unit="Hz">${(w.sampleRate + rand(-5, 5) / 10).toFixed(1)}</sampleRate>\n` +
        `        </writer>`;
    }).join('\n');
    const readersXml = t.readers.map((r) => {
      const p = spec.participants[r.participant];
      return `        <reader guid="${r.guid}" participantGuid="${p.guid}" ip="${p.ip}" status="ALIVE">\n` +
        `          <qos ${qosAttrs(r.qos)}/>\n` +
        `        </reader>`;
    }).join('\n');
    const tqa = qosAttrs(t.qos);
    const inner = [writersXml, readersXml].filter(Boolean).join('\n');
    return `    <topic name="${t.name}" type="${t.type}" partition="${t.partition}">\n` +
      `      <qos ${tqa}/>\n` +
      (inner ? inner + '\n' : '') +
      `    </topic>`;
  }).join('\n');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<dds:snapshot xmlns:dds="urn:dds:monitor:1.0" nodeId="${spec.nodeId}" domainId="${spec.domainId}" ` +
    `timestamp="${fmtIso(now)}" seq="${rand(1000, 9999)}" status="OK">\n` +
    `  <participants>\n${participantsXml}\n  </participants>\n` +
    `  <topics>\n${topicsXml}\n  </topics>\n` +
    `</dds:snapshot>\n`
  );
}

function createDemo(configManager) {
  const dir = () => path.join(configManager.resolveWatchDir(), 'demo');

  function ensureDir() {
    fs.mkdirSync(dir(), { recursive: true });
    return dir();
  }

  // 冷启动种子：写入 3 个域、每域若干参与者/主题、含故意不兼容的配对。
  // 幂等：已有 seed 文件则跳过（不重复写入、不覆盖现场数据）。
  function seedDataset() {
    ensureDir();
    const files = [];
    for (const spec of DOMAIN_SPECS) {
      const name = `seed_domain_${spec.domainId}.xml`;
      const target = path.join(dir(), name);
      if (fs.existsSync(target)) continue;
      const tmp = target + '.tmp';
      fs.writeFileSync(tmp, buildDomainXml(spec, new Date()), 'utf8');
      fs.renameSync(tmp, target);
      files.push(name);
    }
    return files;
  }

  // 原子写：生成一份带随机波动的域 0 快照（验证实时链路）
  function emitAtomic(count) {
    ensureDir();
    const files = [];
    const base = DOMAIN_SPECS[0];
    for (let i = 0; i < count; i++) {
      const now = new Date();
      const name = `demo_${now.getTime()}_${rand(1000, 9999)}.xml`;
      const tmp = path.join(dir(), name + '.tmp');
      const target = path.join(dir(), name);
      fs.writeFileSync(tmp, buildDomainXml(base, now), 'utf8');
      fs.renameSync(tmp, target);
      files.push(name);
    }
    return files;
  }

  // 慢速分块写：验证 FR-01 不会把半截 XML 当有效数据
  function emitSlow(chunks, intervalMs) {
    ensureDir();
    const now = new Date();
    const name = `slow_${now.getTime()}.xml`;
    const target = path.join(dir(), name);
    const full = buildDomainXml(DOMAIN_SPECS[0], now);
    const size = Math.ceil(full.length / chunks);
    const pieces = [];
    for (let i = 0; i < chunks; i++) pieces.push(full.slice(i * size, (i + 1) * size));

    let written = 0;
    const timer = setInterval(() => {
      if (written >= pieces.length) {
        clearInterval(timer);
        return;
      }
      fs.appendFileSync(target, pieces[written], 'utf8');
      written++;
    }, intervalMs);
    if (timer.unref) timer.unref();
    return name;
  }

  return { emitAtomic, emitSlow, seedDataset, buildDomainXml };
}

module.exports = { createDemo };
