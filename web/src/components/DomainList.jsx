import React, { useMemo } from 'react';
import { StatusBadge, fmtTime, Empty } from '../ui.jsx';

function Ips({ ips }) {
  if (!ips || !ips.length) return <span className="dim">—</span>;
  const shown = ips.slice(0, 2);
  const rest = ips.length - shown.length;
  return (
    <span className="mono ip-cell" title={ips.join(', ')}>
      {shown.join(', ')}
      {rest > 0 ? <span className="ip-more"> +{rest}</span> : null}
    </span>
  );
}

// L0：Domain 域级列表（主视图）
export default function DomainList({ domains, onOpen }) {
  const total = useMemo(() => {
    const sum = domains.reduce(
      (acc, d) => {
        acc.participants += d.participantCount || 0;
        acc.topics += d.topicCount || 0;
        acc.ips += d.ipCount || 0;
        return acc;
      },
      { participants: 0, topics: 0, ips: 0 }
    );
    return { ...sum, domains: domains.length };
  }, [domains]);

  if (!domains.length) {
    return (
      <div className="panel">
        <Empty text="未发现 DDS 域。请检查监听目录，或点击「演示数据」生成示例。" />
      </div>
    );
  }

  return (
    <div className="panel table-panel">
      <div className="panel-head domain-total">
        <span className="domain-total-label">
          全部域：<b>{total.domains}</b> 个 · 参与者 <b>{total.participants}</b> · IP <b>{total.ips}</b> · 主题 <b>{total.topics}</b>
        </span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>域 ID</th>
              <th>参与者</th>
              <th>IP</th>
              <th>主题</th>
              <th>写 / 读端点</th>
              <th>健康</th>
              <th>不兼容主题</th>
              <th>速率/分</th>
              <th>最近更新</th>
            </tr>
          </thead>
          <tbody>
            {domains.map((d) => (
              <tr key={d.domainId} onClick={() => onOpen(d.domainId)} tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') onOpen(d.domainId); }}>
                <td className="mono domain-id">{d.domainId}</td>
                <td>{d.participantCount}</td>
                <td><Ips ips={d.ips} /></td>
                <td>{d.topicCount}</td>
                <td>{d.writerCount} / {d.readerCount}</td>
                <td><StatusBadge status={d.status} /></td>
                <td>{d.incompatibleTopics > 0 ? <span className="incompat-count">{d.incompatibleTopics}</span> : <span className="dim">0</span>}</td>
                <td>{d.recordRate}</td>
                <td className="mono">{fmtTime(d.lastUpdate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
