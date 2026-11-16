import React from 'react';

// 共享的状态 / 结论色板与徽标（FR-06-34：OK 青绿 / WARN 橙 / ERROR 红 / UNKNOWN 灰）
export const STATUS_CLASS = { OK: 'st-ok', WARN: 'st-warn', ERROR: 'st-err', UNKNOWN: 'st-unknown' };
export const VERDICT_CLASS = {
  COMPATIBLE: 'v-compatible',
  PARTIAL: 'v-partial',
  INCOMPATIBLE: 'v-incompatible',
  UNKNOWN: 'v-unknown',
};
export const VERDICT_LABEL = {
  COMPATIBLE: '兼容',
  PARTIAL: '部分兼容',
  INCOMPATIBLE: '不兼容',
  UNKNOWN: '未知',
};

export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false });
}

export function StatusBadge({ status }) {
  const s = status || 'UNKNOWN';
  return <span className={`status ${STATUS_CLASS[s] || 'st-unknown'}`}>{s}</span>;
}

export function VerdictBadge({ verdict }) {
  const v = verdict || 'UNKNOWN';
  return <span className={`status verdict ${VERDICT_CLASS[v] || 'v-unknown'}`}>{VERDICT_LABEL[v] || v}</span>;
}

// 简单键值对展示（QoS 明细等）
export function KV({ label, value }) {
  return (
    <div className="kv">
      <span className="kv-label">{label}</span>
      <span className="kv-value">{value == null || value === '' ? '—' : String(value)}</span>
    </div>
  );
}

export function Empty({ text }) {
  return <div className="placeholder">{text || '暂无数据'}</div>;
}
