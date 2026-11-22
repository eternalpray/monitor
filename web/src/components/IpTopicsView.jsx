import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { api } from '../api.js';
import { Empty } from '../ui.jsx';
import { formatTopicName, useTopicRadix } from '../topicName.js';
import { useAliases, aliasLabel } from '../aliases.js';

function TopicChips({ list, radix, color }) {
  if (!list || !list.length) return <span className="dim">—</span>;
  return (
    <span className="topic-chips">
      {list.map((t) => (
        <span key={t} className="chip" style={{ borderColor: color }} title={t}>
          {formatTopicName(t, radix)}
        </span>
      ))}
    </span>
  );
}

// 节点主题视图（解析 endpoint 部分）：按 IP 节点列出其发布（datawriter）/ 订阅（datareader）主题。
export default function IpTopicsView({ domainId, onSelectIp }) {
  const radix = useTopicRadix();
  const { aliases } = useAliases();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');

  const load = useCallback(() => {
    api.ipTopics(domainId)
      .then((r) => { setData(r); setError(null); })
      .catch((e) => setError(e.message));
  }, [domainId]);

  useEffect(() => { load(); }, [load]);

  const ips = useMemo(() => {
    if (!data) return [];
    const filter = q.toLowerCase();
    return (data.ips || []).filter((it) => {
      if (!filter) return true;
      const hay = [it.ip, ...it.sendTopics, ...it.receiveTopics].join(' ').toLowerCase();
      return hay.includes(filter);
    });
  }, [data, q]);

  if (error) return <Empty text={error} />;
  if (!data) return <Empty text="加载中…" />;

  return (
    <div className="panel">
      <div className="panel-head">
        <span>节点主题视图 · 域 {domainId}</span>
        <div className="view-toolbar">
          <input placeholder="按 IP / 主题过滤" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>节点（IP）</th><th>发布主题数</th><th>订阅主题数</th><th>发布主题</th><th>订阅主题</th></tr>
          </thead>
          <tbody>
            {ips.map((it) => (
              <tr key={it.ip} onClick={() => onSelectIp && onSelectIp(it.ip)}>
                <td className="mono ip-cell link">{aliasLabel(it.ip, aliases)}</td>
                <td>{it.sendTopics.length}</td>
                <td>{it.receiveTopics.length}</td>
                <td><TopicChips list={it.sendTopics} radix={radix} color="#2fbf8f" /></td>
                <td><TopicChips list={it.receiveTopics} radix={radix} color="#5b7cc4" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!ips.length && <Empty text="该域没有可展示的 IP 节点" />}
    </div>
  );
}
