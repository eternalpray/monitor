import React, { useMemo } from 'react';

function Card({ label, value, sub }) {
  return (
    <div className="card">
      <div className="card-value">{value}</div>
      <div className="card-label">{label}</div>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  );
}

// 全局概览卡片：域数 / 节点 / 参与者 / 主题 / 在线节点 / 在线参与者。
export default function OverviewCards({ domains, stats }) {
  const agg = useMemo(() => {
    const sum = { domains: 0, nodes: 0, participants: 0, topics: 0, nodeOnline: 0, participantOnline: 0 };
    for (const d of domains || []) {
      sum.domains += 1;
      sum.nodes += d.nodeCount || 0;
      sum.participants += d.participantCount || 0;
      sum.topics += d.topicCount || 0;
      sum.nodeOnline += d.nodeOnlineCount || 0;
      sum.participantOnline += d.participantOnlineCount || 0;
    }
    return sum;
  }, [domains]);

  const last = stats && stats.lastUpdate ? new Date(stats.lastUpdate).toLocaleTimeString('zh-CN', { hour12: false }) : '—';

  return (
    <div className="cards">
      <Card label="域" value={agg.domains} />
      <Card label="节点总数" value={agg.nodes} sub={`在线 ${agg.nodeOnline}`} />
      <Card label="参与者" value={agg.participants} sub={`在线 ${agg.participantOnline}`} />
      <Card label="主题" value={agg.topics} sub={`最近更新 ${last}`} />
    </div>
  );
}
