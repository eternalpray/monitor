import React, { useState } from 'react';

// 左侧多层级导航：概览（域级视图） + 每域 3 个子视图（域级视图 / 节点主题视图 / 主题交互视图）。
// view = { kind: 'overview'|'domain', domainId?, sub?: 'participants'|'ip-topics'|'topics' }

const DOMAIN_SUBS = [
  { key: 'participants', label: '域级视图', hint: 'participant' },
  { key: 'ip-topics', label: '节点主题视图', hint: 'endpoint' },
  { key: 'topics', label: '主题交互视图', hint: 'endpoint' },
];

function isActive(view, kind, domainId, sub) {
  if (view.kind !== kind) return false;
  if (kind === 'domain') return view.domainId === domainId && view.sub === sub;
  return true;
}

export default function Sidebar({ domains, view, onSelect }) {
  const [expandedDomains, setExpandedDomains] = useState(new Set());
  const [showDomainTree, setShowDomainTree] = useState(true);

  const toggleDomain = (id) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <nav className="sidebar">
      <button
        className={`nav-item ${view.kind === 'overview' ? 'active' : ''}`}
        onClick={() => onSelect({ kind: 'overview' })}
      >
        <span className="nav-ico">▦</span>概览（域级视图）
      </button>

      <div className="nav-group">
        <button className="nav-group-head" onClick={() => setShowDomainTree((s) => !s)}>
          <span className="nav-toggle">{showDomainTree ? '▾' : '▸'}</span> 域（{domains.length}）
        </button>
        {showDomainTree && (
          <div className="nav-tree">
            {domains.map((d) => {
              const open = expandedDomains.has(d.domainId);
              const domainActive = view.kind === 'domain' && view.domainId === d.domainId;
              return (
                <div key={d.domainId}>
                  <button
                    className={`nav-item nav-domain ${domainActive ? 'active' : ''}`}
                    onClick={() => { toggleDomain(d.domainId); onSelect({ kind: 'domain', domainId: d.domainId, sub: 'participants' }); }}
                  >
                    <span className="nav-toggle">{open ? '▾' : '▸'}</span>
                    <span className="mono">域 {d.domainId}</span>
                    <span className="nav-badge">{d.participantCount || 0}</span>
                  </button>
                  {open && (
                    <div className="nav-subtree">
                      {DOMAIN_SUBS.map((s) => (
                        <button
                          key={s.key}
                          className={`nav-item nav-sub ${isActive(view, 'domain', d.domainId, s.key) ? 'active' : ''}`}
                          onClick={() => onSelect({ kind: 'domain', domainId: d.domainId, sub: s.key })}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {!domains.length && <div className="nav-empty">暂无域数据</div>}
          </div>
        )}
      </div>
    </nav>
  );
}
