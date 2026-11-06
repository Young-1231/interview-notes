// 校验「Agent 后端工程」章节格式:node scripts/check-guide.cjs guide/agent-backend/*.md
const fs = require('fs');
const BANNED = /原文|资料里|资料中|本资料|八股|笔记作者|如下图|见下图/;
let bad = 0;
for (const f of process.argv.slice(2)) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  const err = (i, m) => { console.log(`✗ ${f}:${i + 1} ${m}`); bad++; };
  let fence = false, h2 = 0, h3 = [], quote = false, codeLen = 0, codeStart = 0;
  lines.forEach((ln, i) => {
    if (/^\s*```/.test(ln)) {
      if (!fence) { fence = true; codeLen = 0; codeStart = i; if (!/^\s*```\w+/.test(ln)) err(i, '代码块要标注语言'); }
      else { fence = false; if (codeLen > 30) err(codeStart, `代码块 ${codeLen} 行,超过 30 行`); }
      return;
    }
    if (fence) { codeLen++; return; }
    const h = ln.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lv = h[1].length;
      if (lv === 1 || lv > 4) err(i, `不允许 ${h[1]} 标题`);
      if (lv === 2) {
        h2++;
        if (i > 1 && h2 === 1 && lines.slice(0, i).some((x) => x.trim())) err(i, '## 章标题必须在文件开头');
        if (!/^\d+\.\s.+\s\{(必学|按需|进阶)\}$/.test(h[2])) err(i, '章标题格式应为「## N. 标题 {必学|按需|进阶}」');
      }
      if (lv === 3) h3.push(h[2].trim());
      return;
    }
    if (h2 === 1 && !h3.length && /^>\s/.test(ln)) quote = true;
    const m = ln.match(BANNED);
    if (m) err(i, `出现字眼「${m[0]}」`);
  });
  if (fence) err(lines.length - 1, '代码块没有闭合');
  if (h2 !== 1) err(0, `每个文件只能有一个 ## 章标题(现在 ${h2} 个)`);
  if (!quote) err(0, '章标题下缺少一句话引用块(> ...)');
  // 总览(0)和收尾章(12、13)结构不同,只要求有自测
  const no = +((lines.find((x) => /^## /.test(x)) || '').match(/^## (\d+)/) || [])[1];
  const needs = [0, 12, 13].includes(no) ? ['自测'] : ['在链路中的位置', '生产环境怎么做', '自测'];
  for (const need of needs) if (!h3.includes(need)) err(0, `缺少「### ${need}」`);
  console.log(`${bad ? '·' : '✓'} ${f}: ${h3.length} 节`);
}
process.exitCode = bad ? 1 : 0;
