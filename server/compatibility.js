'use strict';

// ---------------------------------------------------------------------------
// QoS 兼容性静态判定引擎（PRD 10.5）：纯函数，无网络 / 无文件 / 不修改配置。
// 术语遵循 DDS RxO：Offered = 发布端（writer）提供的值，Requested = 订阅端（reader）要求的值。
// ---------------------------------------------------------------------------

// 顺序值：用于「Offered ≥ Requested」类比较（值越大越强）。
const ENUM_ORDER = {
  reliability: { BEST_EFFORT: 0, RELIABLE: 1 },
  durability: { VOLATILE: 0, TRANSIENT_LOCAL: 1, TRANSIENT: 2, PERSISTENT: 3 },
  liveliness: { AUTOMATIC: 0, MANUAL_BY_PARTICIPANT: 1, MANUAL_BY_TOPIC: 2 },
};

// 修复建议文案
const SUGGESTIONS = {
  type: '发布端与订阅端类型名不一致；请统一 Topic 的类型定义。',
  partition: '发布分区与订阅分区无交集；请统一分区名，或为订阅端增加对应分区。',
  reliability: '订阅端要求更强的可靠性，但发布端提供较弱；请提升发布端可靠性，或放宽订阅端要求。',
  durability: '订阅端要求的持久性高于发布端提供；请提升发布端 Durability，或放宽订阅端要求。',
  deadline: '订阅端 Deadline 严于发布端；请缩短发布端 Deadline，或放宽订阅端要求。',
  liveliness: 'Liveliness 不匹配；请对齐发布端与订阅端的 Liveliness kind / lease。',
  ownership: 'Ownership 不一致；请统一为 SHARED 或 EXCLUSIVE。',
  qosMissing: '采集数据未包含该 QoS 字段，无法判定；请在采集节点补充该 QoS 上报。',
};

function isNumericLike(v) {
  if (typeof v === 'number') return true;
  if (typeof v !== 'string') return false;
  return v.trim() !== '' && !Number.isNaN(Number(v));
}

// deadline / lease：缺失或 INF 视为无穷大；无法识别（非数字、非 INF）返回 null 表示「缺失待判」。
function toDuration(v) {
  if (v == null || v === '') return 'INF';
  if (v === 'INF' || String(v).toUpperCase() === 'INF') return 'INF';
  if (isNumericLike(v)) return Number(v);
  return null;
}

function enumOrderValue(val, dimension) {
  if (val == null) return null;
  const order = ENUM_ORDER[dimension];
  const key = String(val).toUpperCase();
  return order[key] !== undefined ? order[key] : null; // null = 未识别
}

function partitionSet(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((s) => s !== '');
  return [String(v)];
}

// 单条枚举维度检查（reliability / durability / liveliness-kind）
function enumCheck(dimension, offeredVal, requestedVal, offeredLt, requestedLt) {
  const o = enumOrderValue(offeredVal, dimension);
  const r = enumOrderValue(requestedVal, dimension);
  const rule = dimension === 'reliability' ? 'Offered ≥ Requested（BEST_EFFORT < RELIABLE）'
    : dimension === 'durability' ? 'Offered ≥ Requested（VOLATILE < TRANSIENT_LOCAL < TRANSIENT < PERSISTENT）'
      : 'Offered.kind ≥ Requested.kind（AUTOMATIC < MANUAL_BY_PARTICIPANT < MANUAL_BY_TOPIC）';
  if (o == null || r == null) {
    return {
      dimension,
      offered: offeredVal != null ? offeredVal : null,
      requested: requestedVal != null ? requestedVal : null,
      rule,
      passed: false,
      missing: true,
      note: o == null && r == null ? SUGGESTIONS.qosMissing
        : o == null ? '发布端未上报该 QoS，无法判定' : '订阅端未上报该 QoS，无法判定',
    };
  }
  const passed = o >= r;
  return {
    dimension,
    offered: offeredVal,
    requested: requestedVal,
    rule,
    passed,
    missing: false,
    note: passed ? undefined : `${offeredVal} < ${requestedVal}，不满足 Offered ≥ Requested`,
  };
}

// 判定单个 writer × reader 配对
function checkPair(domainId, topic, writer, reader, idx) {
  const offered = writer.qos || {};
  const requested = reader.qos || {};
  const checks = [];

  // 2. 类型名：必须一致
  const wt = writer.type != null ? String(writer.type) : null;
  const rt = reader.type != null ? String(reader.type) : null;
  if (wt == null || rt == null) {
    checks.push({ dimension: 'type', offered: wt, requested: rt, rule: '类型名必须一致', passed: false, missing: true, note: SUGGESTIONS.qosMissing });
  } else if (wt === rt) {
    checks.push({ dimension: 'type', offered: wt, requested: rt, rule: '类型名必须一致', passed: true, missing: false });
  } else {
    checks.push({ dimension: 'type', offered: wt, requested: rt, rule: '类型名必须一致', passed: false, missing: false, note: SUGGESTIONS.type });
  }

  // 3. Partition：双方交集或均为空
  const op = partitionSet(offered.partition);
  const rp = partitionSet(requested.partition);
  const partitionPass = (op.length === 0 && rp.length === 0) || op.some((p) => rp.includes(p));
  checks.push({
    dimension: 'partition',
    offered: op.length ? op : [],
    requested: rp.length ? rp : [],
    rule: '分区集合需有交集，或双方均为空',
    passed: partitionPass,
    missing: false,
    note: partitionPass ? undefined : SUGGESTIONS.partition,
  });

  // 4~5. Reliability / Durability：Offered ≥ Requested
  checks.push(enumCheck('reliability', offered.reliability, requested.reliability));
  checks.push(enumCheck('durability', offered.durability, requested.durability));

  // 6. Deadline：Offered.period ≤ Requested.period（INF 视为无穷大）
  const od = toDuration(offered.deadline);
  const rd = toDuration(requested.deadline);
  if (od == null || rd == null) {
    checks.push({ dimension: 'deadline', offered: offered.deadline != null ? offered.deadline : null, requested: requested.deadline != null ? requested.deadline : null, rule: 'Offered.period ≤ Requested.period（INF 为无穷大）', passed: false, missing: true, note: SUGGESTIONS.qosMissing });
  } else {
    const deadlinePass = od === 'INF' ? rd === 'INF' : (rd === 'INF' ? true : od <= rd);
    checks.push({ dimension: 'deadline', offered: offered.deadline != null ? offered.deadline : 'INF', requested: requested.deadline != null ? requested.deadline : 'INF', rule: 'Offered.period ≤ Requested.period（INF 为无穷大）', passed: deadlinePass, missing: false, note: deadlinePass ? undefined : SUGGESTIONS.deadline });
  }

  // 7. Liveliness：kind ≥ 且 lease ≤
  const liveKind = enumCheck('liveliness', offered.liveliness, requested.liveliness);
  checks.push(liveKind);
  if (!liveKind.missing) {
    const ol = toDuration(offered.livelinessLease);
    const rl = toDuration(requested.livelinessLease);
    if (ol == null || rl == null) {
      checks.push({ dimension: 'livelinessLease', offered: offered.livelinessLease != null ? offered.livelinessLease : null, requested: requested.livelinessLease != null ? requested.livelinessLease : null, rule: 'Offered.lease ≤ Requested.lease', passed: false, missing: true, note: SUGGESTIONS.qosMissing });
    } else {
      const leasePass = ol === 'INF' ? rl === 'INF' : (rl === 'INF' ? true : ol <= rl);
      checks.push({ dimension: 'livelinessLease', offered: offered.livelinessLease != null ? offered.livelinessLease : 'INF', requested: requested.livelinessLease != null ? requested.livelinessLease : 'INF', rule: 'Offered.lease ≤ Requested.lease', passed: leasePass, missing: false, note: leasePass ? undefined : '发布端 lease 长于订阅端要求' });
    }
  }

  // 8. Ownership：必须相等（无顺序，仅比较是否一致）
  const oo = offered.ownership != null ? String(offered.ownership) : null;
  const ro = requested.ownership != null ? String(requested.ownership) : null;
  if (oo == null || ro == null) {
    checks.push({ dimension: 'ownership', offered: oo, requested: ro, rule: '必须相等（SHARED / EXCLUSIVE）', passed: false, missing: true, note: SUGGESTIONS.qosMissing });
  } else {
    const ownershipPass = oo.toUpperCase() === ro.toUpperCase();
    checks.push({ dimension: 'ownership', offered: offered.ownership, requested: requested.ownership, rule: '必须相等（SHARED / EXCLUSIVE）', passed: ownershipPass, missing: false, note: ownershipPass ? undefined : SUGGESTIONS.ownership });
  }

  const missingDims = checks.filter((c) => c.missing).map((c) => c.dimension);
  const failed = checks.filter((c) => !c.missing && !c.passed);
  let verdict;
  if (missingDims.length) verdict = 'UNKNOWN';
  else if (failed.length) verdict = 'INCOMPATIBLE';
  else verdict = 'COMPATIBLE';

  const suggestions = failed.map((c) => SUGGESTIONS[c.dimension]).filter(Boolean);

  return {
    pairId: `${writer.guid || 'w' + idx}|${reader.guid || 'r' + idx}`,
    domainId,
    topic,
    writerIp: writer.ip != null ? writer.ip : null,
    readerIp: reader.ip != null ? reader.ip : null,
    writerGuid: writer.guid != null ? writer.guid : null,
    readerGuid: reader.guid != null ? reader.guid : null,
    writerParticipant: writer.participantGuid != null ? writer.participantGuid : null,
    readerParticipant: reader.participantGuid != null ? reader.participantGuid : null,
    verdict,
    checks,
    suggestions,
    evaluatedAt: null, // 由调用方补齐（引擎为纯函数，不读时钟）
  };
}

// 主题级结论聚合（PRD 7.3）
function aggregateVerdict(results) {
  if (!results || !results.length) return 'UNKNOWN';
  if (results.every((r) => r.verdict === 'UNKNOWN')) return 'UNKNOWN';
  const incompat = results.some((r) => r.verdict === 'INCOMPATIBLE');
  const compat = results.some((r) => r.verdict === 'COMPATIBLE');
  if (incompat && compat) return 'PARTIAL';
  if (incompat) return 'INCOMPATIBLE';
  return 'COMPATIBLE';
}

// 主入口：对同一 domainId + topic 的 writer × reader 全配对做判定。
// input: { domainId, topic, topicType, writers[], readers[], maxPairs }
function evaluateCompatibility(input) {
  const { domainId, topic, writers = [], readers = [], maxPairs = 400 } = input;
  const results = [];
  let truncated = false;
  let pairCount = 0;
  const cap = Math.max(1, Number(maxPairs) || 400);

  for (let i = 0; i < writers.length; i++) {
    for (let j = 0; j < readers.length; j++) {
      if (pairCount >= cap) { truncated = true; break; }
      results.push(checkPair(domainId, topic, writers[i], readers[j], pairCount));
      pairCount++;
    }
    if (truncated) break;
  }

  return { verdict: aggregateVerdict(results), results, truncated };
}

module.exports = { evaluateCompatibility, aggregateVerdict, ENUM_ORDER };
