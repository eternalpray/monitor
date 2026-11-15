import React, { useMemo, useState } from 'react';

function JsonTree({ data, depth = 0 }) {
  if (data === null) return <span className="j-null">null</span>;
  if (data === undefined) return <span className="j-null">undefined</span>;
  if (typeof data !== 'object') {
    if (typeof data === 'string') return <span className="j-str">"{data}"</span>;
    if (typeof data === 'number') return <span className="j-num">{data}</span>;
    if (typeof data === 'boolean') return <span className="j-bool">{String(data)}</span>;
    return <span>{String(data)}</span>;
  }
  const isArr = Array.isArray(data);
  const keys = Object.keys(data);
  if (!keys.length) return <span>{isArr ? '[]' : '{}'}</span>;
  const indent = { paddingLeft: depth * 14 };
  if (depth > 5) return <span className="j-ellipsis">{isArr ? '[…]' : '{…}'}</span>;
  return (
    <div style={indent}>
      <span className="j-brace">{isArr ? '[' : '{'}</span>
      {keys.map((k) => {
        const v = data[k];
        const keyLabel = isArr ? k : `"${k}"`;
        return (
          <div key={k}>
            <span className="j-key">{keyLabel}: </span>
            <JsonTree data={v} depth={depth + 1} />
          </div>
        );
      })}
      <span className="j-brace">{isArr ? ']' : '}'}</span>
    </div>
  );
}

export default function DetailDrawer({ record, onClose }) {
  const [tab, setTab] = useState('tree');

  const rawXml = useMemo(() => record.rawXml || '', [record]);

  function copy() {
    navigator.clipboard && navigator.clipboard.writeText(rawXml).catch(() => {});
  }

  return (
    <div className="drawer-mask" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <span className="drawer-title">记录详情</span>
          <button className="close" onClick={onClose}>×</button>
        </div>

        <div className="drawer-meta">
          <span>节点 <b>{record.node}</b></span>
          <span>域 <b>{record.domain}</b></span>
          <span>状态 <b>{record.status}</b></span>
          <span>类型 <b>{record.kind}</b></span>
          <span>文件 <b>{record.fileName}</b></span>
        </div>

        <div className="drawer-tabs">
          <button className={tab === 'tree' ? 'active' : ''} onClick={() => setTab('tree')}>解析结构 (JSON)</button>
          <button className={tab === 'raw' ? 'active' : ''} onClick={() => setTab('raw')}>原始 XML</button>
        </div>

        <div className="drawer-body">
          {tab === 'tree' ? (
            <pre className="json-view"><JsonTree data={record.raw || record} /></pre>
          ) : (
            <div className="raw-wrap">
              {record.xmlTruncated && <div className="truncated-hint">原文已截断（超过预览上限）</div>}
              <button className="copy-btn" onClick={copy}>复制</button>
              <pre className="raw-xml">{rawXml || '(无原始 XML)'}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
