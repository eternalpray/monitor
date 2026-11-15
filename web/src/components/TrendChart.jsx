import React, { useMemo } from 'react';

// 自绘 SVG 折线图，不引入图表库
export default function TrendChart({ metricNames, series, onSelect }) {
  const W = 620, H = 180, PAD_L = 46, PAD_R = 12, PAD_T = 12, PAD_B = 22;
  const points = series.points || [];

  const { path, area, minV, maxV, lastV } = useMemo(() => {
    if (!points.length) return { path: '', area: '', minV: 0, maxV: 1, lastV: null };
    const xs = points.map((p, i) => PAD_L + (i / Math.max(points.length - 1, 1)) * (W - PAD_L - PAD_R));
    const vals = points.map((p) => Number(p.v));
    let min = Math.min(...vals), max = Math.max(...vals);
    if (min === max) { min -= 1; max += 1; }
    const ys = vals.map((v) => PAD_T + (1 - (v - min) / (max - min)) * (H - PAD_T - PAD_B));
    const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
    const a = `${d} L${xs[xs.length - 1].toFixed(1)},${H - PAD_B} L${xs[0].toFixed(1)},${H - PAD_B} Z`;
    return { path: d, area: a, minV: min, maxV: max, lastV: vals[vals.length - 1] };
  }, [points]);

  return (
    <div className="panel trend">
      <div className="panel-head">
        <span>数值趋势</span>
        <select value={series.metric || ''} onChange={(e) => onSelect(e.target.value)}>
          <option value="">选择指标…</option>
          {metricNames.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        {lastV != null && <span className="trend-last">最新 {lastV.toFixed(2)}</span>}
      </div>
      <div className="trend-body">
        {points.length === 0 ? (
          <div className="placeholder">选择指标后展示趋势（无数据）</div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="trend-svg" preserveAspectRatio="none">
            <path d={area} fill="rgba(91,124,196,0.12)" />
            <path d={path} fill="none" stroke="#5b7cc4" strokeWidth="1.6" />
            <text x={PAD_L} y={H - 4} fontSize="9" fill="#7a869c">{minV.toFixed(1)}</text>
            <text x={PAD_L} y={PAD_T + 8} fontSize="9" fill="#7a869c">{maxV.toFixed(1)}</text>
          </svg>
        )}
      </div>
    </div>
  );
}
