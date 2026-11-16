import React, { useState } from 'react';
import { VerdictBadge, Empty } from '../ui.jsx';

function fmtVal(v) {
  if (v == null) return '—';
  if (Array.isArray(v)) return v.join(', ') || '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function CheckRow({ c }) {
  const cls = c.missing ? 'check-missing' : c.passed ? 'check-pass' : 'check-fail';
  return (
    <tr className={cls}>
      <td className="mono">{c.dimension}</td>
      <td className="mono">{fmtVal(c.offered)}</td>
      <td className="mono">{fmtVal(c.requested)}</td>
      <td className="rule-text">{c.rule}</td>
      <td>{c.missing ? <span className="check-tag tag-missing">缺失</span> : c.passed ? <span className="check-tag tag-pass">通过</span> : <span className="check-tag tag-fail">不通过</span>}</td>
      <td className="rule-text">{c.note || ''}</td>
    </tr>
  );
}

function PairCard({ r }) {
  const [open, setOpen] = useState(false);
  const failed = (r.checks || []).filter((c) => !c.missing && !c.passed);
  const missing = (r.checks || []).filter((c) => c.missing);
  return (
    <div className="pair-card">
      <div className="pair-head" onClick={() => setOpen((o) => !o)}>
        <span className="pair-toggle">{open ? '▾' : '▸'}</span>
        <span className="mono">{r.writerIp || '—'} → {r.readerIp || '—'}</span>
        <VerdictBadge verdict={r.verdict} />
        {failed.length > 0 && <span className="dim">不通过 {failed.length} 项</span>}
        {missing.length > 0 && <span className="dim">缺失 {missing.length} 项</span>}
      </div>
      {open && (
        <div className="pair-body">
          <table>
            <thead>
              <tr><th>维度</th><th>Offered（发布）</th><th>Requested（订阅）</th><th>判定规则</th><th>结果</th><th>建议</th></tr>
            </thead>
            <tbody>
              {(r.checks || []).map((c, i) => <CheckRow key={i} c={c} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// 兼容性分析展示（FR-06-23~29）
export default function CompatibilityPanel({ compatibility }) {
  const results = (compatibility && compatibility.results) || [];
  if (!results.length) return <Empty text="无可判定的 writer × reader 配对" />;

  function copySummary() {
    const lines = [`主题兼容性结论：${compatibility.verdict}`];
    for (const r of results) {
      lines.push(`  ${r.writerIp} → ${r.readerIp}: ${r.verdict}`);
      for (const c of (r.checks || []).filter((x) => !x.passed)) {
        lines.push(`    - [${c.dimension}] ${c.note || ''}`);
      }
    }
    const text = lines.join('\n');
    navigator.clipboard && navigator.clipboard.writeText(text).catch(() => {});
  }

  return (
    <div className="compat-panel">
      <div className="compat-head">
        <VerdictBadge verdict={compatibility.verdict} />
        {compatibility.truncated && <span className="dim">端点过多，仅展示抽样结果</span>}
        <button className="link-btn" onClick={copySummary}>复制诊断摘要</button>
      </div>
      {results.map((r, i) => <PairCard key={i} r={r} />)}
    </div>
  );
}
