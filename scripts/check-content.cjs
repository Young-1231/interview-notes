// 校验统一稿格式:node scripts/check-content.cjs content/jvm.md ...
const fs = require('fs');
let bad = 0;
const BANNED = /原文|资料里|资料中|本资料|笔记作者|这份八股|八股文|背下来就|面试官最爱|如下图|见下图|标红/;
for (const f of process.argv.slice(2)) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  let fence = false, groups = 0, qs = 0, cur = null, empty = [];
  const err = (i, m) => { console.log(`✗ ${f}:${i + 1} ${m}`); bad++; };
  lines.forEach((ln, i) => {
    if (/^\s*```/.test(ln)) { fence = !fence; return; }
    if (fence) return;
    const h = ln.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lv = h[1].length;
      if (lv === 2) groups++;
      else if (lv === 3) {
        if (cur && !cur.body) empty.push(cur.title);
        qs++; cur = { title: h[2], body: false };
        if (!groups) err(i, '题目出现在第一个 ## 子分组之前');
      } else err(i, `不允许的 ${h[1]} 标题:${h[2].slice(0, 30)}`);
      return;
    }
    if (cur && ln.trim()) cur.body = true;
    const m = ln.match(BANNED);
    if (m) err(i, `出现来源/口水字眼「${m[0]}」`);
  });
  if (cur && !cur.body) empty.push(cur.title);
  if (fence) err(lines.length - 1, '代码块没有闭合');
  if (empty.length) { console.log(`✗ ${f}: ${empty.length} 题没有答案,如:${empty.slice(0, 3).join(' / ')}`); bad++; }
  console.log(`${bad ? '·' : '✓'} ${f}: ${groups} 组 · ${qs} 题`);
}
process.exitCode = bad ? 1 : 0;
