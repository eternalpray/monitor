import React from 'react';

// 内联详情面板（替代原右侧滑入抽屉）：标题 + 面包屑 + 关闭按钮，用于右侧详情栏。
export default function DetailPanel({ title, crumbs = [], onClose, children, actions }) {
  return (
    <div className="detail-panel">
      <div className="detail-panel-head">
        <div className="detail-panel-crumbs">
          {crumbs.map((c, i) => (
            <span key={i} className="crumb" onClick={c.onClick} title={c.title || ''}>
              {c.label} <span className="crumb-sep">/</span>
            </span>
          ))}
          <span className="detail-panel-title">{title}</span>
        </div>
        <div className="detail-panel-actions">
          {actions}
          <button className="close" onClick={onClose}>×</button>
        </div>
      </div>
      <div className="detail-panel-body">{children}</div>
    </div>
  );
}
