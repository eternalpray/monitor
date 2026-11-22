import React, { useEffect, useRef } from 'react';
import { formatTopicName, useTopicRadix } from '../topicName.js';

const STATUS_CLASS = { OK: 'st-ok', WARN: 'st-warn', ERROR: 'st-err', UNKNOWN: 'st-unknown' };

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

function keyMetrics(r) {
  const keys = Object.keys(r.numericMetrics || {}).slice(0, 3);
  if (!keys.length) return '—';
  return keys.map((k) => `${k.split('.').pop()}=${r.numericMetrics[k]}`).join('  ');
}

export default function RecordsTable({ records, onSelect }) {
  const radix = useTopicRadix();
  const bodyRef = useRef(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [records.length]);

  if (!records.length) {
    return <div className="panel"><div className="placeholder">暂无记录。等待采集节点落盘，或点击「演示数据」生成示例。</div></div>;
  }

  return (
    <div className="panel table-panel">
      <div className="table-scroll" ref={bodyRef}>
        <table>
          <thead>
            <tr>
              <th>时间</th><th>节点</th><th>域</th><th>状态</th><th>类型</th><th>Topic</th>
              <th>关键数值</th><th>来源文件</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} onClick={() => onSelect(r)}>
                <td className="mono">{fmtTime(r.timestampIso || r.receivedAt)}</td>
                <td title={r.node}>{r.node}</td>
                <td>{r.domain}</td>
                <td><span className={`status ${STATUS_CLASS[r.status] || 'st-unknown'}`}>{r.status}</span></td>
                <td><span className="kind">{r.kind}</span>{r.typeName ? <span className="kind-type"> {r.typeName}</span> : null}</td>
                <td className="mono topic-cell" title={(r.topics || []).map((t) => t.name).join(', ')}>
                  {(r.topics || []).map((t) => formatTopicName(t.name, radix)).join(', ') || '—'}
                </td>
                <td className="mono metrics-cell">{keyMetrics(r)}</td>
                <td className="file-cell" title={r.filePath}>{r.fileName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
