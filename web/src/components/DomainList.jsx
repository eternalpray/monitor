import React from 'react';
import { StatusBadge, Empty } from '../ui.jsx';

function Metric({ label, value }) {
  return (
    <div className="dm">
      <span className="dm-v">{value == null ? '—' : value}</span>
      <span className="dm-l">{label}</span>
    </div>
  );
}

// 总览域级视图：卡片网格，鼠标悬停展开该域简要信息（端口范围 / 组播地址 / 节点 / 参与者在线离线 / 主题）。
export default function DomainList({ domains, onOpen }) {
  if (!domains.length) {
    return (
      <div className="panel">
        <Empty text="未发现 DDS 域。请导入 XML 或点击「设置 → 演示数据」生成示例。" />
      </div>
    );
  }

  return (
    <div className="domain-grid">
      {domains.map((d) => (
        <div
          key={d.domainId}
          className="domain-card"
          onClick={() => onOpen(d.domainId)}
          tabIndex={0}
          role="button"
          onKeyDown={(e) => { if (e.key === 'Enter') onOpen(d.domainId); }}
        >
          <div className="domain-card-head">
            <span className="domain-id">域 {d.domainId}</span>
            <StatusBadge status={d.status} />
          </div>
          <div className="domain-card-metrics">
            <Metric label="节点" value={d.nodeCount} />
            <Metric label="参与者" value={`${d.participantOnlineCount ?? d.participantCount}/${d.participantCount}`} />
            <Metric label="主题" value={d.topicCount} />
          </div>
          <div className="domain-card-more">
            <div className="dm-row"><span>端口范围</span><b className="mono">{d.portRange || '—'}</b></div>
            <div className="dm-row"><span>发现组播</span><b className="mono">{d.multicastAddress || '—'}</b></div>
            <div className="dm-row"><span>节点总数</span><b>{d.nodeCount ?? '—'}</b></div>
            <div className="dm-row"><span>节点在线/离线</span><b>{d.nodeOnlineCount ?? 0} / {d.nodeOfflineCount ?? 0}</b></div>
            <div className="dm-row"><span>参与者在线/离线</span><b>{d.participantOnlineCount ?? 0} / {d.participantOfflineCount ?? 0}</b></div>
            <div className="dm-row"><span>发布/订阅主题</span><b>{d.publishTopicCount ?? 0} / {d.subscribeTopicCount ?? 0}</b></div>
          </div>
        </div>
      ))}
    </div>
  );
}
