import React from 'react';

// 通用抽屉骨架：右侧滑入 + 面包屑 + 遮罩关闭。L2 抽屉叠加在 L1 之上（通过 zIndex 区分）。
export default function DrawerFrame({ title, crumbs = [], onClose, width = '60%', zIndex = 100, children, actions }) {
  return (
    <div className="drawer-mask" style={{ zIndex }} onClick={onClose}>
      <div className="drawer" style={{ width: `min(${width}, 96vw)` }} onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div className="drawer-crumbs">
            {crumbs.map((c, i) => (
              <span key={i} className="crumb" onClick={c.onClick} title={c.title || ''}>
                {c.label} <span className="crumb-sep">/</span>
              </span>
            ))}
            <span className="drawer-title">{title}</span>
          </div>
          <div className="drawer-head-actions">
            {actions}
            <button className="close" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
}
