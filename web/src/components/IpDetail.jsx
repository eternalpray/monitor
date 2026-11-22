import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { Empty } from '../ui.jsx';
import { formatTopicName, useTopicRadix } from '../topicName.js';
import { useAliases } from '../aliases.js';

function TopicList({ title, list, radix, color }) {
  return (
    <div className="ip-list">
      <div className="section-title">{title}（{list.length}）</div>
      {list.length ? (
        <table>
          <thead><tr><th>主题</th><th>类型</th><th>端点数</th></tr></thead>
          <tbody>
            {list.map((t, i) => (
              <tr key={t.name + i}>
                <td className="mono" style={{ color }}>{formatTopicName(t.name, radix)}</td>
                <td className="kind-type">{t.type || '—'}</td>
                <td>{t.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <Empty text="无" />}
    </div>
  );
}

function PeerList({ title, list, color }) {
  return (
    <div className="ip-list">
      <div className="section-title">{title}（{list.length}）</div>
      {list.length ? (
        <table>
          <thead><tr><th>交互节点 IP</th><th>主题</th></tr></thead>
          <tbody>
            {list.map((p, i) => (
              <tr key={p.ip + i}>
                <td className="mono" style={{ color }}>{p.ip}</td>
                <td className="mono ip-cell">{p.topics.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <Empty text="无" />}
    </div>
  );
}

// 单 IP 节点详情：别名（可编辑）+ 发送/接收主题 + 交互节点。
export default function IpDetail({ domainId, ip }) {
  const radix = useTopicRadix();
  const { aliases, setAlias, deleteAlias } = useAliases();
  const [detail, setDetail] = useState(null);
  const [inter, setInter] = useState(null);
  const [error, setError] = useState(null);
  const [aliasInput, setAliasInput] = useState('');

  const load = useCallback(() => {
    api.ipDetail(domainId, ip).then((r) => { setDetail(r); setError(null); }).catch((e) => setError(e.message));
    api.ipInteractions(domainId, ip).then((r) => setInter(r)).catch(() => setInter(null));
  }, [domainId, ip]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setAliasInput(aliases[ip] || ''); }, [aliases, ip]);

  const saveAlias = async () => {
    await setAlias(ip, aliasInput);
  };
  const clearAlias = async () => {
    setAliasInput('');
    await deleteAlias(ip);
  };

  if (error) return <Empty text={error} />;
  if (!detail) return <Empty text="加载中…" />;

  const alias = aliases[ip];

  return (
    <>
      <div className="drawer-meta">
        <span>IP <b className="mono">{detail.ip}</b></span>
        <span>发送主题 <b>{detail.sendTopicCount}</b></span>
        <span>接收主题 <b>{detail.receiveTopicCount}</b></span>
      </div>

      <div className="alias-editor">
        <label>节点别名</label>
        <input
          value={aliasInput}
          onChange={(e) => setAliasInput(e.target.value)}
          placeholder={alias || '给该 IP 配置别名'}
        />
        <button onClick={saveAlias}>保存</button>
        {alias && <button className="link-btn" onClick={clearAlias}>清除</button>}
      </div>

      <TopicList title="发送主题（datawriter）" list={detail.sendTopics || []} radix={radix} color="#2fbf8f" />
      <TopicList title="接收主题（datareader）" list={detail.receiveTopics || []} radix={radix} color="#5b7cc4" />

      {inter && (inter.sendTo.length || inter.receiveFrom.length) ? (
        <>
          <div className="section-title">交互节点</div>
          <PeerList title="发送给" list={inter.sendTo} color="#2fbf8f" />
          <PeerList title="接收自" list={inter.receiveFrom} color="#5b7cc4" />
        </>
      ) : null}
    </>
  );
}
