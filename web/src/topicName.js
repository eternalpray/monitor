import { createContext, useContext } from 'react';

// 主题名展示进制：16 = 原样（hex），10 = 十进制。
// ljdds 快照的 topic_name 是 8 位十六进制 ID（如 00000402），demo/seed 用人类可读名。
export const DEFAULT_RADIX = 16;

// 判断是否应做 hex→dec 转换：纯 hex 字符，且带前导 0 或长度 ≥ 8（避免把 "abc"/"face" 等词误判）。
const HEX_TOPIC = /^[0-9a-fA-F]{2,16}$/;

export function formatTopicName(name, radix) {
  if (name == null) return '';
  const s = String(name);
  if (radix !== 10) return s;
  if (!HEX_TOPIC.test(s)) return s;
  if (!(s[0] === '0' || s.length >= 8)) return s;
  const n = parseInt(s, 16);
  return Number.isNaN(n) ? s : String(n);
}

// 全局进制 Context：App 用 Provider 包裹整棵树，组件内 useTopicRadix() 读取。
export const TopicRadixContext = createContext(DEFAULT_RADIX);

export function useTopicRadix() {
  return useContext(TopicRadixContext);
}
