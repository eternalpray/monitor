import React, { useState } from 'react';
import { api } from '../api.js';

// 监控端配置弹窗：编辑 ljdds_monitor_service_cfg.ini / domaincfg.xml / topiccfg.xml。
// initial 来自 monitor.status().config。

function defaultMulticast(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0 && n <= 255) return `239.255.${Math.floor(n)}.1`;
  return '';
}

export default function MonitorConfigDialog({ initial, onClose, onSaved }) {
  const [projectName, setProjectName] = useState((initial && initial.project_name) || '');
  const [startTime, setStartTime] = useState((initial && initial.start_time) || '');
  const [refreshPeriod, setRefreshPeriod] = useState((initial && initial.refresh_period) != null ? initial.refresh_period : 60);
  const [isSelf, setIsSelf] = useState((initial && initial.is_self) != null ? initial.is_self : 0);
  const [domains, setDomains] = useState(
    (initial && initial.domains && initial.domains.length ? initial.domains : [{ value: '', multicast_address: '' }])
      .map((d) => ({ value: d.value || '', multicast_address: d.multicast_address || '' }))
  );
  const [topics, setTopics] = useState((initial && initial.topics) || []);
  const [newTopic, setNewTopic] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function setDomain(idx, patch) {
    setDomains((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }

  function addDomain() {
    setDomains((prev) => [...prev, { value: '', multicast_address: '' }]);
  }

  function removeDomain(idx) {
    setDomains((prev) => prev.filter((_, i) => i !== idx));
  }

  function addTopic() {
    const t = newTopic.trim();
    if (!t) return;
    if (topics.includes(t)) { setNewTopic(''); return; }
    setTopics((prev) => [...prev, t]);
    setNewTopic('');
  }

  function removeTopic(t) {
    setTopics((prev) => prev.filter((x) => x !== t));
  }

  function buildPayload() {
    const ds = domains
      .map((d) => ({ value: d.value.trim(), multicast_address: d.multicast_address.trim() || defaultMulticast(d.value.trim()) }))
      .filter((d) => d.value);
    return {
      project_name: projectName.trim(),
      start_time: startTime.trim(),
      refresh_period: Number(refreshPeriod) || 60,
      is_self: isSelf,
      domains: ds,
      topics,
    };
  }

  async function save() {
    setError('');
    const payload = buildPayload();
    if (!payload.project_name) { setError('请填写 project_name（项目名称）'); return; }
    if (!payload.start_time) { setError('请填写 start_time（开始时间）'); return; }
    if (!payload.domains.length) { setError('请至少配置一个监控域'); return; }
    setSaving(true);
    try {
      const r = await api.saveMonitorConfig(payload);
      if (onSaved) onSaved(r.config);
      onClose();
    } catch (e) {
      setError(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="monitor-dialog-mask" onClick={onClose}>
      <div className="monitor-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="monitor-dialog-head">
          <span className="monitor-dialog-title">监控端配置</span>
          <button className="close" onClick={onClose}>×</button>
        </div>

        <div className="monitor-dialog-body">
          <div className="mform-grid">
            <label className="mform">
              <span>项目名称 project_name <b className="req">*</b></span>
              <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="H125" />
            </label>
            <label className="mform">
              <span>开始时间 start_time <b className="req">*</b></span>
              <input value={startTime} onChange={(e) => setStartTime(e.target.value)} placeholder="20261112-210300" />
            </label>
            <label className="mform">
              <span>刷新周期 refresh_period（秒）</span>
              <input type="number" min="1" value={refreshPeriod} onChange={(e) => setRefreshPeriod(e.target.value)} />
            </label>
            <label className="mform">
              <span>监控范围 is_self</span>
              <select value={isSelf} onChange={(e) => setIsSelf(e.target.value)}>
                <option value={0}>0（所有 DDS）</option>
                <option value={1}>1（仅 LJDDS）</option>
              </select>
            </label>
          </div>

          <div className="mform-section">
            <div className="mform-section-head">
              <span>监控域（至少一个，组播地址默认 239.255.&lt;域名&gt;.1）<b className="req">*</b></span>
              <button onClick={addDomain}>+ 添加域</button>
            </div>
            {domains.map((d, i) => (
              <div className="domain-row" key={i}>
                <input
                  className="domain-value"
                  value={d.value}
                  onChange={(e) => setDomain(i, { value: e.target.value, multicast_address: d.multicast_address || defaultMulticast(e.target.value) })}
                  placeholder="域名，如 29"
                />
                <input
                  className="domain-mc"
                  value={d.multicast_address}
                  onChange={(e) => setDomain(i, { multicast_address: e.target.value })}
                  placeholder="239.255.x.1"
                />
                <button className="row-del" onClick={() => removeDomain(i)}>×</button>
              </div>
            ))}
          </div>

          <div className="mform-section">
            <div className="mform-section-head">
              <span>监控主题（留空 = 监控所有主题）</span>
            </div>
            <div className="topic-add">
              <input value={newTopic} onChange={(e) => setNewTopic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTopic()} placeholder="如 02B1->FF15" />
              <button onClick={addTopic}>+ 添加</button>
            </div>
            {topics.length > 0 && (
              <div className="topic-chips">
                {topics.map((t) => (
                  <span className="chip" key={t}>
                    {t}
                    <button className="chip-del" onClick={() => removeTopic(t)}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {error && <div className="mform-error">{error}</div>}
        </div>

        <div className="monitor-dialog-foot">
          <button onClick={onClose}>取消</button>
          <button onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
        </div>
      </div>
    </div>
  );
}
