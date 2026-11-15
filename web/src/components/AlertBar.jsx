import React from 'react';

export default function AlertBar({ alerts, onDismiss }) {
  if (!alerts || !alerts.length) return null;
  return (
    <div className="alert-stack">
      {alerts.map((a) => (
        <div key={a.id} className={`alert alert-${a.level || 'info'}`}>
          <span className="alert-msg">
            {a.file ? <span className="alert-file">{a.file}: </span> : null}
            {a.message || '未知告警'}
          </span>
          <button className="alert-close" onClick={() => onDismiss(a.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
