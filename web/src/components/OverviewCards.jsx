import React, { useMemo } from 'react';

function Card({ label, value, sub, accent }) {
  return (
    <div className={`card ${accent || ''}`}>
      <div className="card-value">{value}</div>
      <div className="card-label">{label}</div>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  );
}

// 全局概览卡片（FR-06-31）：总域数 / 总参与者 / 总 IP / 总主题 / 近 1 分钟速率 / 解析失败
export default function OverviewCards({ domains, stats }) {
  const agg = useMemo(() => {
    const sum = { domains: 0, participants: 0, ips: new Set(), topics: 0 };
    for (const d of domains || []) {
      sum.domains += 1;
      sum.participants += d.participantCount || 0;
      sum.topics += d.topicCount || 0;
      for (const ip of d.ips || []) sum.ips.add(ip);
    }
    return { ...sum, ipCount: sum.ips.size };
  }, [domains]);

  const rate = stats ? stats.rate1m : null;
  const last = stats && stats.lastUpdate ? new Date(stats.lastUpdate).toLocaleTimeString() : '—';
  const parseFail = stats ? stats.parseFail : 0;

  return (
    <div className="cards">
      <Card label="域数" value={agg.domains} />
      <Card label="参与者" value={agg.participants} />
      <Card label="去重 IP" value={agg.ipCount} />
      <Card label="主题" value={agg.topics} />
      <Card label="近1分钟速率" value={rate == null ? '—' : `${rate}/min`} sub={`最近更新 ${last}`} />
      <Card label="解析失败" value={parseFail} accent={parseFail > 0 ? 'card-warn' : ''} />
    </div>
  );
}
