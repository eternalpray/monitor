import React from 'react';

export default function FilterBar({ filters, setFilters, nodes, topics, total, shown }) {
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const statuses = ['OK', 'WARN', 'ERROR', 'UNKNOWN'];

  return (
    <div className="filterbar">
      <select value={filters.node} onChange={(e) => set('node', e.target.value)}>
        <option value="">全部节点</option>
        {nodes.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>

      <select value={filters.topic} onChange={(e) => set('topic', e.target.value)}>
        <option value="">全部 Topic</option>
        {topics.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>

      <select value={filters.status} onChange={(e) => set('status', e.target.value)}>
        <option value="">全部状态</option>
        {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      <input
        className="filter-q"
        placeholder="关键字（节点/Topic/类型/文件）"
        value={filters.q}
        onChange={(e) => set('q', e.target.value)}
      />

      <label className="pause-toggle">
        <input type="checkbox" checked={filters.paused} onChange={(e) => set('paused', e.target.checked)} />
        暂停滚动
      </label>

      <span className="filter-count">显示 {shown} / {total}</span>
    </div>
  );
}
