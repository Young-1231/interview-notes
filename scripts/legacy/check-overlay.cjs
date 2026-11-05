// 只校验 overlays/<topic>.md,不写任何文件(可多人并行跑)
//   node scripts/check-overlay.cjs jvm juc ...
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const TITLES = require('./build-sources.cjs').titlesByTopic();
let bad = 0;
for (const tid of process.argv.slice(2)) {
  const f = path.join(ROOT, 'overlays', `${tid}.md`);
  if (!TITLES[tid]) { console.log(`✗ ${tid}: 主题不存在`); bad++; continue; }
  if (!fs.existsSync(f)) { console.log(`- ${tid}: 还没有 overlay`); continue; }
  const titles = TITLES[tid];
  const text = fs.readFileSync(f, 'utf8');
  let fence = false, fixes = 0, adds = 0, quiz = 0, mode = null;
  for (const [i, ln] of text.split('\n').entries()) {
    if (/^\s*```/.test(ln)) { fence = !fence; continue; }
    if (fence) continue;
    const h2 = ln.match(/^## (.+)$/);
    if (h2) {
      const t = h2[1].trim();
      const m = t.match(/^(纠正|补充)\s*[:：]\s*(.+)$/);
      if (m) {
        mode = null; m[1] === '纠正' ? fixes++ : adds++;
        const n = titles.filter((x) => x.includes(m[2].trim())).length;
        if (!n) { console.log(`✗ ${tid}.md:${i + 1}「${m[1]}: ${m[2]}」没有匹配到任何题目标题`); bad++; }
      } else if (/^自测/.test(t)) mode = 'quiz';
      else if (/^导读/.test(t)) mode = null;
      else { console.log(`✗ ${tid}.md:${i + 1} 未知二级标题「${t}」(只允许 导读 / 纠正: / 补充: / 自测)`); bad++; }
    } else if (/^### /.test(ln) && mode === 'quiz') quiz++;
    else if (/^# /.test(ln)) { console.log(`✗ ${tid}.md:${i + 1} 不要用一级标题`); bad++; }
  }
  console.log(`${bad ? '' : '✓'} ${tid}: 纠正 ${fixes} · 补充 ${adds} · 自测 ${quiz}`);
}
process.exitCode = bad ? 1 : 0;
