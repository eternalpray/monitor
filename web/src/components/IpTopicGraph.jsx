import React, { useMemo } from 'react';
import { Empty } from '../ui.jsx';

const VERDICT_COLOR = {
  COMPATIBLE: '#2fbf8f',
  PARTIAL: '#e0a03c',
  INCOMPATIBLE: '#e0605f',
  UNKNOWN: '#6b7280',
};

function agg(verdicts) {
  if (!verdicts.length) return 'UNKNOWN';
  if (verdicts.every((v) => v === 'UNKNOWN')) return 'UNKNOWN';
  const inc = verdicts.some((v) => v === 'INCOMPATIBLE');
  const com = verdicts.some((v) => v === 'COMPATIBLE');
  if (inc && com) return 'PARTIAL';
  if (inc) return 'INCOMPATIBLE';
  return 'COMPATIBLE';
}

// SVG 收发关系图（FR-06-20）：发送 IP → Topic → 接收 IP，不兼容连线标红/橙。
export default function IpTopicGraph({ topic }) {
  const W = 480;
  const { sendIps, receiveIps, results, name } = topic || {};

  const graph = useMemo(() => {
    const sends = sendIps || [];
    const recvs = receiveIps || [];
    const pairs = results || [];

    const sendVerdict = {};
    const recvVerdict = {};
    for (const ip of sends) sendVerdict[ip] = agg(pairs.filter((r) => r.writerIp === ip).map((r) => r.verdict));
    for (const ip of recvs) recvVerdict[ip] = agg(pairs.filter((r) => r.readerIp === ip).map((r) => r.verdict));

    const cx = W / 2;
    const leftX = 40, rightX = W - 40, midY = 90;
    const nodes = [];
    sends.forEach((ip, i) => {
      const y = 30 + i * 40;
      nodes.push({ x: leftX, y, label: ip, type: 'send', color: VERDICT_COLOR[sendVerdict[ip]] });
    });
    const topicY = Math.max(90, 30 + Math.max(sends.length, recvs.length) * 20);
    const topicNode = { x: cx, y: topicY, label: name, type: 'topic', color: '#5b7cc4' };
    recvs.forEach((ip, i) => {
      const y = 30 + i * 40;
      nodes.push({ x: rightX, y, label: ip, type: 'recv', color: VERDICT_COLOR[recvVerdict[ip]] });
    });
    return { sends, recvs, sendVerdict, recvVerdict, nodes, topicNode, topicY };
  }, [sendIps, receiveIps, results, name]);

  if (!graph.sends.length && !graph.recvs.length) return <Empty text="无发送 / 接收 IP" />;

  const { sends, recvs, sendVerdict, recvVerdict, topicNode } = graph;

  return (
    <svg viewBox={`0 0 ${W} ${graph.topicY + 40}`} className="iptopic-svg" preserveAspectRatio="xMidYMid meet">
      {/* 发送 → Topic 连线 */}
      {sends.map((ip, i) => {
        const y = 30 + i * 40;
        return <line key={`s-${i}`} x1={40} y1={y} x2={topicNode.x} y2={topicNode.y} stroke={VERDICT_COLOR[sendVerdict[ip]] || '#6b7280'} strokeWidth="1.6" />;
      })}
      {/* Topic → 接收连线 */}
      {recvs.map((ip, i) => {
        const y = 30 + i * 40;
        return <line key={`r-${i}`} x1={topicNode.x} y1={topicNode.y} x2={W - 40} y2={y} stroke={VERDICT_COLOR[recvVerdict[ip]] || '#6b7280'} strokeWidth="1.6" />;
      })}
      {/* 节点 */}
      {sends.map((ip, i) => {
        const y = 30 + i * 40;
        return (
          <g key={`sn-${i}`}>
            <circle cx={40} cy={y} r="6" fill={VERDICT_COLOR[sendVerdict[ip]] || '#6b7280'} />
            <text x={52} y={y + 4} fontSize="11" fill="#d8dee9" className="mono">{ip}</text>
          </g>
        );
      })}
      <g>
        <rect x={topicNode.x - 70} y={topicNode.y - 12} width="140" height="24" rx="6" fill="#2a3550" stroke="#5b7cc4" />
        <text x={topicNode.x} y={topicNode.y + 4} fontSize="11" fill="#d8dee9" textAnchor="middle" className="mono">
          {topicNode.label.length > 20 ? topicNode.label.slice(0, 20) + '…' : topicNode.label}
        </text>
      </g>
      {recvs.map((ip, i) => {
        const y = 30 + i * 40;
        return (
          <g key={`rn-${i}`}>
            <circle cx={W - 40} cy={y} r="6" fill={VERDICT_COLOR[recvVerdict[ip]] || '#6b7280'} />
            <text x={W - 52} y={y + 4} fontSize="11" fill="#d8dee9" textAnchor="end" className="mono">{ip}</text>
          </g>
        );
      })}
    </svg>
  );
}
