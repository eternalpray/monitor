'use strict';

const fs = require('fs');
const path = require('path');

function pad(n) { return String(n).padStart(2, '0'); }

function fmtLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// ---------------------------------------------------------------------------
// 演示数据集：多域 + 多参与者 + 多 IP + 故意不兼容的 QoS 配对。
// 输出格式与新采集节点一致（ljdds_monitor_service → service_data → domain）。
// ---------------------------------------------------------------------------

// 每个域由若干参与者（节点）与若干主题（端点）构成。
// 参与者：{ name, ip, host, pid, qos }；主题：{ name, type, writers:[{participant, qos, sampleRate}], readers:[{participant, qos}] }
// 端点 QoS 可覆盖参与者 QoS（用于构造故意不兼容的配对）。
const DOMAIN_SPECS = [
  {
    domainId: '0',
    participants: [
      { name: 'PubVehicle', ip: '192.168.1.11', host: 'ecu-01', pid: '2314', qos: { reliability: 'RELIABLE', durability: 'TRANSIENT_LOCAL', ownership: 'SHARED' } },
      { name: 'SubMonitor', ip: '192.168.1.23', host: 'hmi-01', pid: '881', qos: { reliability: 'RELIABLE', durability: 'TRANSIENT_LOCAL', ownership: 'SHARED' } },
      { name: 'Logger', ip: '192.168.1.24', host: 'log-01', pid: '902', qos: { reliability: 'BEST_EFFORT', durability: 'VOLATILE', ownership: 'SHARED' } },
    ],
    topics: [
      {
        name: 'rt/vehicle/pose', type: 'geometry::Pose',
        writers: [
          { participant: 0, qos: { reliability: 'RELIABLE', durability: 'TRANSIENT_LOCAL', ownership: 'SHARED' }, sampleRate: 50.2 },
        ],
        readers: [
          { participant: 1, qos: { reliability: 'RELIABLE', durability: 'TRANSIENT_LOCAL', ownership: 'SHARED' } },
          { participant: 2, qos: { reliability: 'BEST_EFFORT', durability: 'VOLATILE', ownership: 'SHARED' } },
        ],
      },
      { name: 'rt/chassis/status', type: 'ChassisStatus', writers: [], readers: [] },
    ],
  },
  {
    domainId: '1',
    participants: [
      { name: 'Planner', ip: '10.0.0.11', host: 'planner-01', pid: '1101', qos: { reliability: 'RELIABLE', durability: 'VOLATILE', ownership: 'SHARED' } },
      { name: 'Executor', ip: '10.0.0.22', host: 'exec-01', pid: '2202', qos: { reliability: 'BEST_EFFORT', durability: 'VOLATILE', ownership: 'SHARED' } },
    ],
    topics: [
      {
        name: 'plan/trajectory', type: 'Trajectory',
        writers: [
          { participant: 0, qos: { reliability: 'RELIABLE', durability: 'VOLATILE', ownership: 'SHARED' }, sampleRate: 20.0 },
        ],
        readers: [
          // 故意不兼容：订阅端要求 RELIABLE，发布端 BEST_EFFORT
          { participant: 1, qos: { reliability: 'RELIABLE', durability: 'VOLATILE', ownership: 'SHARED' } },
        ],
      },
    ],
  },
  {
    domainId: '2',
    participants: [
      { name: 'Sensor', ip: '172.16.0.10', host: 'sensor-01', pid: '3101', qos: { reliability: 'BEST_EFFORT', durability: 'VOLATILE', ownership: 'SHARED' } },
      { name: 'Fusion', ip: '172.16.0.20', host: 'fusion-01', pid: '3202', qos: { reliability: 'BEST_EFFORT', durability: 'VOLATILE', ownership: 'SHARED' } },
    ],
    topics: [
      {
        name: 'raw/imu', type: 'ImuSample',
        writers: [
          { participant: 0, qos: { reliability: 'BEST_EFFORT', durability: 'VOLATILE', ownership: 'SHARED' }, sampleRate: 100.0 },
        ],
        readers: [
          { participant: 1, qos: { reliability: 'BEST_EFFORT', durability: 'VOLATILE', ownership: 'SHARED' } },
        ],
      },
    ],
  },
];

const VENDOR = { value: '0x0102', name: 'PrismTech Inc. - OpenSplice DDS' };

// 生成 participant 的 RTPS guid：HostId=IP,AppId=N,InstanceId=1,EntityId=449
function participantGuid(ip, appId) {
  return `HostId=${ip},AppId=${appId},InstanceId=1,EntityId=449`;
}

function endpointGuid(ip, appId, entityId) {
  return `HostId=${ip},AppId=${appId},InstanceId=1,EntityId=${entityId}`;
}

// QoS 归一为真实采集格式的值（reliability 会故意保留不兼容对）
function qVal(qos, key, fallback) {
  if (qos && qos[key]) return qos[key];
  return fallback;
}

// <qos> 内部子元素
function qosInner(qos, strength) {
  const q = qos || {};
  const parts = [];
  parts.push(`<entity_name value = "${q.entityName || 'Unknown Name'}"/>`);
  parts.push(`<reliability>${qVal(q, 'reliability', 'RELIABLE')}</reliability>`);
  parts.push(`<durability_service_history_kind>KEEP_LAST</durability_service_history_kind>`);
  if (q.durability !== 'VOLATILE') parts.push(`<durability_service_history_depth>1</durability_service_history_depth>`);
  parts.push(`<durability>${qVal(q, 'durability', 'VOLATILE')}</durability>`);
  parts.push(`<ownership>${qVal(q, 'ownership', 'SHARED')}</ownership>`);
  if (strength != null) parts.push(`<ownership_strength>${strength}</ownership_strength>`);
  return parts.join('\n');
}

// 单类 locator 容器
function locators(key, type, port, address) {
  return `<${key} count = "1">\n<element>\n<type value = "${type}"/>\n<port value = "${port}"/>\n<address value = "${address}"/>\n</element>\n</${key}>`;
}

function buildDomainXml(spec, now) {
  const domainId = Number(spec.domainId);
  const base = 7400 + domainId * 100;
  const multicast = `239.255.${domainId}.1`;

  const participantsXml = spec.participants.map((p, i) => {
    const appId = 1000 + i + domainId * 10;
    const guid = participantGuid(p.ip, appId);
    const loc = [
      locators('metatraffic_unicast_locators', 'UDPv4', base + 10, p.ip),
      locators('metatraffic_multicast_locators', 'UDPv4', base, multicast),
      locators('default_unicast_locators', 'UDPv4', base + 11, p.ip),
    ].join('\n');
    return `  <element guid = "${guid}">
    <online_info count = "1">
      <element online_timestamp = "${fmtLocal(now)}" downline_timestamp = ""/>
    </online_info>
    <host value = "${p.ip}"/>
    <entity_name value = "${p.name}"/>
    <vendor_id value = "${VENDOR.value}" name = "${VENDOR.name}"/>
    <rtps_version value = "0x0201"/>
${loc}
    <property count = "0">
    </property>
  </element>`;
  }).join('\n');

  // 端点：datawriter / datareader
  const endpointsXml = spec.topics.map((t) => {
    const writerXml = (t.writers || []).map((w) => {
      const p = spec.participants[w.participant];
      const appId = 1000 + w.participant + domainId * 10;
      const guid = endpointGuid(p.ip, appId, 2147483651); // writer entity id
      const pubsub = endpointGuid(p.ip, appId, 776);      // publisher
      const strength = w.qos && w.qos.ownership === 'EXCLUSIVE' ? 2 : undefined;
      return `  <element guid = "${guid}" endpoint_type = "datawriter" pubsub_guid = "${pubsub}" topic_name = "${t.name}" type_name = "${t.type}" idlfile = "">
    <qos>
${qosInner(w.qos, strength)}
    </qos>
  </element>`;
    }).join('\n');
    const readerXml = (t.readers || []).map((r) => {
      const p = spec.participants[r.participant];
      const appId = 1000 + r.participant + domainId * 10;
      const guid = endpointGuid(p.ip, appId, 2147483652); // reader entity id
      const pubsub = endpointGuid(p.ip, appId, 777);      // subscriber
      const strength = r.qos && r.qos.ownership === 'EXCLUSIVE' ? 2 : undefined;
      return `  <element guid = "${guid}" endpoint_type = "datareader" pubsub_guid = "${pubsub}" topic_name = "${t.name}" type_name = "${t.type}" idlfile = "">
    <qos>
${qosInner(r.qos, strength)}
    </qos>
  </element>`;
    }).join('\n');
    return [writerXml, readerXml].filter(Boolean).join('\n');
  }).join('\n');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<ljdds_monitor_service>\n` +
    `  <service_data domain_count = "${DOMAIN_SPECS.length}">\n` +
    `    <domain value = "${spec.domainId}">\n` +
    `      <participant>\n${participantsXml}\n      </participant>\n` +
    `      <endpoint>\n${endpointsXml}\n      </endpoint>\n` +
    `    </domain>\n` +
    `  </service_data>\n` +
    `</ljdds_monitor_service>\n`
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

  // 慢速分块写：验证不会把半截 XML 当有效数据
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
