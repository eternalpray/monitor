import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { api } from '../api.js';
import { Empty } from '../ui.jsx';
import { formatTopicName, useTopicRadix } from '../topicName.js';

// 主题交互视图（解析 endpoint 部分）：以主题为筛选标识，点击主题查看交互图 + 明细表。
export default function TopicListView({ domainId, revision, onOpenTopic }) {
  const radix = useTopicRadix();
  const [topics, setTopics] = useState([]);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');

  const load = useCallback(() => {
    api.domain(domainId)
      .then((r) => { setTopics(r.topics || []); setError(null); })
      .catch((e) => setError(e.message));
  }, [domainId]);

  useEffect(() => { load(); }, [load, revision]);

  const filtered = useMemo(() => {
    if (!q) return topics;
    const f = q.toLowerCase();
    return topics.filter((t) => `${t.name} ${formatTopicName(t.name, 10)} ${t.type || ''}`.toLowerCase().includes(f));
  }, [topics, q, radix]);

  if (error) return <div className="panel"><Empty text={error} /></div>;

  return (
    <div className="panel">
      <div className="panel-head">
        <span>主题交互视图 · 域 {domainId}</span>
        <div className="view-toolbar">
          <input placeholder="按主题名过滤" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="table-scroll">
        {filtered.length ? (
          <table>
            <thead>
              <tr><th>主题</th><th>数据类型</th><th>发送端</th><th>接收端</th><th>操作</th></tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.name}>
                  <td className="mono">{formatTopicName(t.name, radix)}</td>
                  <td className="kind-type">{t.type || '—'}</td>
                  <td>{t.writerCount}</td>
                  <td>{t.readerCount}</td>
                  <td><button className="link-btn" onClick={() => onOpenTopic && onOpenTopic(t.name)}>查看交互</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty text="该域没有可展示的主题" />}
      </div>
    </div>
  );
}
