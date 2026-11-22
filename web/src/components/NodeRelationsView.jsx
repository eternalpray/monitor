import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { api } from '../api.js';
import { Empty } from '../ui.jsx';
import { formatTopicName, useTopicRadix } from '../topicName.js';

// 需求 4：按主题的节点（IP）间收发关系，含自发自收。
// 上方表格逐主题列出 sender IP / receiver IP；下方 SVG 画节点→节点有向边（边标注主题数，自发自收画回环）。
export default function NodeRelationsView({ domainId }) {
  const radix = useTopicRadix();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [onlySelf, setOnlySelf] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(() => {
    api.relations(domainId)
      .then((r) => { setData(r); setError(null); })
      .catch((e) => setError(e.message));
  }, [domainId]);

  useEffect(() => { load(); }, [load]);

  const relations = useMemo(() => {
    if (!data) return [];
    return (data.relations || []).filter((r) => {
      if (onlySelf && !r.selfSendRecv) return false;
      if (q) {
        const hay = `${formatTopicName(r.topic, 10)} ${r.topic} ${r.type || ''}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [data, onlySelf, q, radix]);

  const graph = useMemo(() => {
    if (!data) return null;
    const nodes = (data.nodes || []).slice(0, 40);
    // 聚合边：from|to -> { topics:Set, self }
    const edgeMap = new Map();
    for (const e of data.edges || []) {
      if (nodes.indexOf(e.from) < 0 || nodes.indexOf(e.to) < 0) continue;
      const k = `${e.from}|${e.to}`;
      let cur = edgeMap.get(k);
      if (!cur) { cur = { from: e.from, to: e.to, topics: new Set(), self: e.self }; edgeMap.set(k, cur); }
      cur.topics.add(e.topic);
    }
    const edges = Array.from(edgeMap.values()).map((e) => ({ from: e.from, to: e.to, self: e.self, count: e.topics.size, topics: Array.from(e.topics).slice(0, 6) }));
    return { nodes, edges };
  }, [data]);

  if (error) return <Empty text={error} />;
  if (!data) return <Empty text="加载中…" />;

  return (
    <div className="panel">
      <div className="panel-head">
        <span>节点收发关系 · 域 {domainId}（发送/接收按 endpoint_type 区分）</span>
        <div className="view-toolbar">
          <input placeholder="按主题过滤" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="pause-toggle">
            <input type="checkbox" checked={onlySelf} onChange={(e) => setOnlySelf(e.target.checked)} /> 仅自发自收
          </label>
        </div>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>主题</th><th>类型</th><th>发送节点（IP）</th><th>接收节点（IP）</th><th>自发自收</th></tr>
          </thead>
          <tbody>
            {relations.map((r) => (
              <tr key={r.topic}>
                <td className="mono">{formatTopicName(r.topic, radix)}</td>
                <td className="kind-type">{r.type || '—'}</td>
                <td className="mono ip-cell">{r.senders.length ? r.senders.join(', ') : <span className="dim">—</span>}</td>
                <td className="mono ip-cell">{r.receivers.length ? r.receivers.join(', ') : <span className="dim">—</span>}</td>
                <td>{r.selfSendRecv ? <span className="self-badge">自发自收</span> : <span className="dim">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {graph && graph.nodes.length > 1 && <RelationGraph graph={graph} />}
    </div>
  );
}

function RelationGraph({ graph }) {
  const { nodes, edges } = graph;
  const W = 640, H = 420, cx = W / 2, cy = H / 2, R = Math.min(cx, cy) - 70;
  const pos = useMemo(() => {
    const map = {};
    nodes.forEach((ip, i) => {
      const ang = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
      map[ip] = { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
    });
    return map;
  }, [nodes, cx, cy, R]);

  return (
    <div className="graph-wrap">
      <div className="section-title">节点收发关系图（边标注主题数）</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="iptopic-svg">
        {edges.map((e, i) => {
          const a = pos[e.from], b = pos[e.to];
          if (!a || !b) return null;
          const color = e.self ? '#e0a03c' : '#5b7cc4';
          const stroke = color;
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          if (e.self) {
            // 自发自收回环
            return (
              <g key={i}>
                <path d={`M ${a.x} ${a.y - 10} q 24 -34 0 -44 q -24 10 0 44`} fill="none" stroke={stroke} strokeWidth="1.6" />
                <text x={a.x + 30} y={a.y - 44} fontSize="10" fill={stroke} title={e.topics.join(', ')}>{e.count} 主题（自发自收）</text>
              </g>
            );
          }
          return (
            <g key={i}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth="1.4" />
              <text x={mx} y={my - 2} fontSize="10" fill="#d8dee9" textAnchor="middle" title={e.topics.join(', ')}>
                {e.count} 主题
              </text>
            </g>
          );
        })}
        {nodes.map((ip) => {
          const p = pos[ip];
          return (
            <g key={ip}>
              <circle cx={p.x} cy={p.y} r="7" fill="#2fbf8f" />
              <text x={p.x} y={p.y - 12} fontSize="10" fill="#d8dee9" textAnchor="middle" className="mono">{ip}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
