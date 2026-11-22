import React from 'react';
import { Empty } from '../ui.jsx';
import { formatTopicName, useTopicRadix } from '../topicName.js';

const SEND = '#2fbf8f';
const RECV = '#5b7cc4';
const TOPIC = '#e0a03c';
const MAX_SIDE = 10;

// 主题交互图：主题居中，左侧发送节点（≤10），右侧接收节点（≤10）。
export default function IpTopicGraph({ topic }) {
  const radix = useTopicRadix();
  const name = (topic && topic.name) || '';
  const label = formatTopicName(name, radix);
  const sendIps = (topic && topic.sendIps) || [];
  const receiveIps = (topic && topic.receiveIps) || [];

  if (!sendIps.length && !receiveIps.length) return <Empty text="无发送 / 接收节点" />;

  const sendShown = sendIps.slice(0, MAX_SIDE);
  const recvShown = receiveIps.slice(0, MAX_SIDE);
  const sendMore = sendIps.length - sendShown.length;
  const recvMore = receiveIps.length - recvShown.length;

  const W = 520;
  const leftX = 8, rightX = W - 8, cx = W / 2;
  const rowH = 26;
  const rows = Math.max(sendShown.length, recvShown.length, 1);
  const topicY = 20 + rows * rowH + 12;
  const H = topicY + 40;

  const short = (s) => (s.length > 22 ? s.slice(0, 22) + '…' : s);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="iptopic-svg" preserveAspectRatio="xMidYMid meet">
      {/* 连线：左侧发送 → 主题 */}
      {sendShown.map((ip, i) => {
        const y = 24 + i * rowH;
        return <line key={`s-${i}`} x1={leftX} y1={y} x2={cx - 66} y2={topicY} stroke={SEND} strokeWidth="1.4" />;
      })}
      {/* 连线：主题 → 右侧接收 */}
      {recvShown.map((ip, i) => {
        const y = 24 + i * rowH;
        return <line key={`r-${i}`} x1={cx + 66} y1={topicY} x2={rightX} y2={y} stroke={RECV} strokeWidth="1.4" />;
      })}

      {/* 发送节点 */}
      {sendShown.map((ip, i) => {
        const y = 24 + i * rowH;
        return (
          <g key={`sn-${i}`}>
            <circle cx={leftX} cy={y} r="5" fill={SEND} />
            <text x={leftX + 12} y={y + 4} fontSize="11" fill="#d8dee9" className="mono">{short(ip)}</text>
          </g>
        );
      })}
      {sendMore > 0 && <text x={leftX} y={24 + rows * rowH + 6} fontSize="11" fill="#7a869c" className="mono">+{sendMore} 个发送</text>}

      {/* 主题节点 */}
      <g>
        <rect x={cx - 66} y={topicY - 14} width="132" height="28" rx="8" fill="#2a3550" stroke={TOPIC} />
        <text x={cx} y={topicY + 4} fontSize="11" fill="#d8dee9" textAnchor="middle" className="mono">
          {short(label)}
        </text>
      </g>

      {/* 接收节点 */}
      {recvShown.map((ip, i) => {
        const y = 24 + i * rowH;
        return (
          <g key={`rn-${i}`}>
            <circle cx={rightX} cy={y} r="5" fill={RECV} />
            <text x={rightX - 12} y={y + 4} fontSize="11" fill="#d8dee9" textAnchor="end" className="mono">{short(ip)}</text>
          </g>
        );
      })}
      {recvMore > 0 && <text x={rightX} y={24 + rows * rowH + 6} fontSize="11" fill="#7a869c" textAnchor="end" className="mono">+{recvMore} 个接收</text>}

      {/* 图例 */}
      <g fontSize="10" fill="#7a869c">
        <circle cx={16} cy={H - 14} r="4" fill={SEND} /><text x={24} y={H - 11}>发送节点</text>
        <circle cx={92} cy={H - 14} r="4" fill={RECV} /><text x={100} y={H - 11}>接收节点</text>
        <circle cx={168} cy={H - 14} r="4" fill={TOPIC} /><text x={176} y={H - 11}>主题</text>
      </g>
    </svg>
  );
}
