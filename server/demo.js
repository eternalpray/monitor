'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function pad(n) { return String(n).padStart(2, '0'); }

function fmtLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function createDemo(configManager) {
  const dir = () => path.join(configManager.resolveWatchDir(), 'demo');

  function ensureDir() {
    fs.mkdirSync(dir(), { recursive: true });
    return dir();
  }

  // 生成一份 LJDDS 风格快照 XML（与模板 schema 对齐，数值带随机波动）
  function buildSnapshot(now) {
    const nodeCount = rand(3, 8);
    const onlineNodeCount = rand(2, nodeCount);
    const participantCount = rand(4, 20);
    const writerCount = rand(10, 60);
    const readerCount = rand(20, 120);
    const topicCount = rand(10, 50);
    const hosts = ['192.168.3.40', '192.168.3.52', '192.168.3.61', '168.61.0.24'];

    const participants = [];
    for (let i = 0; i < participantCount; i++) {
      const host = hosts[i % hosts.length];
      const pid = rand(10000, 60000);
      participants.push(
        `    <element guid="HostId=${host},AppId=${rand(1000000, 99999999)},InstanceId=1,EntityId=449">\n` +
        `      <online_info count="1">\n        <element online_timestamp="${fmtLocal(now)}" downline_timestamp=""/>\n      </online_info>\n` +
        `      <host value="${host}"/>\n      <entity_name value="[ENTITY]"/>\n` +
        `      <vendor_id value="0x0201" name="中船 709 研究所 - LJDDS通用版"/>\n` +
        `      <rtps_version value="0x0201"/>\n` +
        `      <property count="2">\n        <element name="dds.sys_info.hostname" value="demo-node-${i}"/>\n        <element name="dds.sys_info.process_id" value="${pid}"/>\n      </property>\n` +
        `    </element>`
      );
    }

    const types = ['CSMXP_V3', 'Pose', 'ChassisStatus', 'VehicleState'];
    const endpoints = [];
    for (let i = 0; i < writerCount + readerCount; i++) {
      const isWriter = i < writerCount;
      const host = hosts[i % hosts.length];
      const type = types[rand(0, types.length - 1)];
      const topic = String(rand(1, 0xffff)).padStart(8, '0');
      const reliability = rand(0, 1) ? 'RELIABLE' : 'BESTEFFORT';
      endpoints.push(
        `    <element guid="HostId=${host},AppId=${rand(1000000, 99999999)},InstanceId=1,EntityId=${rand(1000, 9999)}" endpoint_type="${isWriter ? 'datawriter' : 'datareader'}" pubsub_guid="HostId=${host},AppId=${rand(1000000, 99999999)},InstanceId=1,EntityId=${rand(1000, 9999)}" topic_name="${topic}" type_name="${type}" idlfile="idl/${fmtLocal(now).replace(/[: ]/g, '')}/domain_82/${type}.idl">\n` +
        `      <qos>\n        <entity_name value="Unknown Name"/>\n        <reliability>${reliability}</reliability>\n` +
        `        <durability_service_history_kind>KEEP_LAST</durability_service_history_kind>\n        <durability_service_history_depth>${rand(1, 16)}</durability_service_history_depth>\n` +
        `        <durability>VOLATILE</durability>\n        <ownership>SHARED</ownership>\n      </qos>\n    </element>`
      );
    }

    return (
      `<ljdds_domain_monitor>\n` +
      `  <domain_snapshot domain_count="1" start_timestamp="${fmtLocal(new Date(now.getTime() - 3600000))}" snapshot_timestamp="${fmtLocal(now)}">\n` +
      `    <domain value="82" discovery_multicast_address="239.255.0.1" online_node_count="${onlineNodeCount}" node_count="${nodeCount}" online_participant_count="${participantCount}" participant_count="${participantCount}" topic_count="${topicCount}" writer_count="${writerCount}" reader_count="${readerCount}" vendor_count="1">\n` +
      `      <participant>\n${participants.join('\n')}\n      </participant>\n` +
      `      <endpoint>\n${endpoints.join('\n')}\n      </endpoint>\n` +
      `    </domain>\n  </domain_snapshot>\n</ljdds_domain_monitor>\n`
    );
  }

  // 原子写：先写 .tmp 再 rename（推荐采集节点方式）
  function emitAtomic(count) {
    ensureDir();
    const files = [];
    for (let i = 0; i < count; i++) {
      const now = new Date();
      const name = `demo_${now.getTime()}_${rand(1000, 9999)}.xml`;
      const tmp = path.join(dir(), name + '.tmp');
      const target = path.join(dir(), name);
      fs.writeFileSync(tmp, buildSnapshot(now), 'utf8');
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
    const full = buildSnapshot(now);
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

  return { emitAtomic, emitSlow, buildSnapshot };
}

module.exports = { createDemo };
