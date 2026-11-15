import React, { useMemo } from 'react';

function barList(dist, color) {
  const entries = Object.entries(dist || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!entries.length) return <div className="placeholder">暂无分布数据</div>;
  const max = entries[0][1];
  return (
    <div className="bars">
      {entries.map(([k, v]) => (
        <div className="bar-row" key={k}>
          <span className="bar-label" title={k}>{k}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(v / max) * 100}%`, background: color }} />
          </div>
          <span className="bar-val">{v}</span>
        </div>
      ))}
    </div>
  );
}

export default function Distribution({ stats }) {
  const nodes = useMemo(() => (stats ? barList(stats.nodeDistribution, '#8fd3bc') : null), [stats]);
  const topics = useMemo(() => (stats ? barList(stats.topicDistribution, '#9db8e8') : null), [stats]);

  return (
    <div className="dist-grid">
      <div className="panel">
        <div className="panel-head"><span>节点分布</span></div>
        <div className="panel-body">{nodes || <div className="placeholder">暂无数据</div>}</div>
      </div>
      <div className="panel">
        <div className="panel-head"><span>Topic 分布</span></div>
        <div className="panel-body">{topics || <div className="placeholder">暂无数据</div>}</div>
      </div>
    </div>
  );
}
