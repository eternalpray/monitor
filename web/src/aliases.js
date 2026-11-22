import { createContext, useContext } from 'react';

// IP 节点别名上下文（需求 3）：App 拉取别名并下发，组件内 useAliases() 读取。
export const AliasContext = createContext({ aliases: {}, setAlias: async () => {}, deleteAlias: async () => {} });

export function useAliases() {
  return useContext(AliasContext);
}

// 显示 IP，若配置了别名则附带别名（如「车机A（192.168.1.11）」）
export function aliasLabel(ip, aliases) {
  if (ip == null) return '—';
  const a = aliases && aliases[ip];
  return a ? `${a}（${ip}）` : ip;
}
