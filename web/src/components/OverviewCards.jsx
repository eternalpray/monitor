import React from 'react';

function Card({ label, value, sub, accent }) {
  return (
    <div className={`card ${accent || ''}`}>
      <div className="card-value">{value}</div>
      <div className="card-label">{label}</div>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  );
}

export default function OverviewCards({ stats }) {
  if (!stats) {
    return (
      <div className="cards">
        {['记录总数', '采集节点', 'Topic 数', '近1分钟速率', '最后更新', '解析失败'].map((l) => (
          <div className="card" key={l}><div className="card-value">—</div><div className="card-label">{l}</div></div>
        ))}
      </div>
    );
  }
  const last = stats.lastUpdate ? new Date(stats.lastUpdate).toLocaleTimeString() : '—';
  return (
    <div className="cards">
      <Card label="记录总数" value={stats.bufferedRecords} sub={`累计 ${stats.totalIngested}`} />
      <Card label="采集节点" value={stats.nodeCount} />
      <Card label="Topic 数" value={stats.topicCount} />
      <Card label="近1分钟速率" value={`${stats.rate1m}/min`} />
      <Card label="最后更新" value={last} />
      <Card label="解析失败" value={stats.parseFail} accent={stats.parseFail > 0 ? 'card-warn' : ''} />
    </div>
  );
}
