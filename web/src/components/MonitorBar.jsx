import React from 'react';

// 监控端对接控制栏：状态徽标 + 当前导入文件 + 配置/启动/停止/保存按钮。
// monitor = 后端 status() 对象（含 config/valid、serviceExists、running、lastImport、currentFile）。

function statusOf(monitor) {
  if (!monitor) return { cls: 'st-unknown', label: '加载中…' };
  if (!monitor.serviceExists) return { cls: 'st-err', label: '未找到监控端' };
  if (!monitor.config || !monitor.config.valid) return { cls: 'st-warn', label: '未配置' };
  if (monitor.running) return { cls: 'st-ok', label: '运行中' };
  return { cls: 'st-unknown', label: '已停止' };
}

export default function MonitorBar({ monitor, busy, onConfigure, onStart, onStop, onSave }) {
  const st = statusOf(monitor);
  const last = monitor && monitor.lastImport;
  const valid = monitor && monitor.config && monitor.config.valid;

  return (
    <div className="monitor-bar">
      <div className="monitor-left">
        <span className="monitor-title">监控端</span>
        <span className={`status ${st.cls}`}>{st.label}</span>
        <span className="monitor-file">
          {last
            ? <>已导入 <span className="mono">{last.file}</span>（解析 {last.parsed} 条，新增 {last.added} 条）</>
            : (monitor && monitor.currentFile
              ? <span className="mono">{monitor.currentFile}</span>
              : <span className="dim">等待监控端输出…</span>)}
        </span>
      </div>
      <div className="monitor-actions">
        <button onClick={onConfigure} disabled={busy}>配置</button>
        <button onClick={onStart} disabled={busy} title={valid ? '启动监控端' : '需先完成监控配置'}>启动</button>
        <button onClick={onStop} disabled={busy} title="停止监控端">停止</button>
        <button onClick={onSave} disabled={busy || !monitor || !monitor.currentFile} title="保存当前读取的 XML">保存</button>
      </div>
    </div>
  );
}
