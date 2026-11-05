// 构建八股站:sources/*.md -> data/*.json
//   node scripts/build.cjs
//
// 1. 逐个源文件按章节切分,章节映射到主题(scripts/topics.cjs)
// 2. 章节内识别「分组」和「题目」:有下级标题的是分组,叶子是题目;#### 留在答案里当小标题
// 3. 题目答案渲染成 HTML(markdown-it),颜色 span 规范成语义 class,适配暗色主题
// 4. 合并 overlays/*.md 里的「纠正」「补充」「自测问答」
// 5. 输出 data/index.json(全站目录 + 搜索索引) 和 data/t/<topic>.json(每个主题全量)
const fs = require('fs');
const path = require('path');
const MarkdownIt = require('../vendor/markdown-it.js');
const { PARTS, TOPICS, SOURCES, CHAPTER_MAP, REROUTE } = require('./topics.cjs');

const ROOT = path.resolve(__dirname, '../..');
const md = new MarkdownIt({ html: true, linkify: true, typographer: false });

// ---------------- 工具 ----------------
const stripTags = (s) => s.replace(/<[^>]+>/g, '');
const decodeEnt = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');
const plain = (s) => decodeEnt(stripTags(s)).replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
const EMOJI = /^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]+/u;
const cleanTitle = (s) => plain(s).replace(EMOJI, '').trim();

// 银行 PDF 题目里的「（中国建设银行-2023届 && 交通银行-2024届春招）」-> 公司标签
const COMPANY_RE = /[（(]([^（）()]*(?:银行|届|字节|美团|阿里|腾讯|蚂蚁|滴滴|PDD|拼多多|淘天|快手|小红书|百度|京东|饿了么|华为|网易|携程|招商|一面|二面|三面)[^（）()]*)[）)]\s*$/;
function splitCompanies(title) {
  const m = title.match(COMPANY_RE);
  if (!m) return { title, companies: [] };
  const companies = m[1].replace(/(一|二|三)面(?=\S)/g, '$1面 ').split(/\s*(?:&&|&|、|，|,|\s)\s*/).map((x) => x.trim()).filter(Boolean)
    .map((x) => x.replace(/-\d{4}届.*$/, '').replace(/(一|二|三)面$/, '').replace(/^中国/, '').trim())
    .filter((x) => x && x.length <= 8 && !/^\d{4}(届|秋招|春招)|^(秋招|春招)$|遇到|说说/.test(x));
  return { title: title.slice(0, m.index).trim(), companies: [...new Set(companies)] };
}
const isBank = (c) => /银行|工行|农行|建行|交行|中行|邮储|招行/.test(c);

// 颜色 span -> 语义 class(原资料:红=核心、紫/蓝=重点、黄底=划重点)
const SPAN_CLASS = [
  [/color:\s*rgb\(216,\s*57,\s*49\)/, 'hl-red'],
  [/color:\s*rgb\(100,\s*37,\s*208\)/, 'hl-purple'],
  [/color:\s*rgb\(36,\s*91,\s*219\)/, 'hl-blue'],
  [/color:\s*rgb\(46,\s*161,\s*33\)/, 'hl-green'],
  [/color:\s*rgb\((?:220,155,4|222,120,2)\)/, 'hl-orange'],
  [/color:\s*rgb\(143,\s*149,\s*158\)/, 'hl-gray'],
  [/background-color:\s*rgba?\((?:255,\s*246,\s*122|255,\s*233,\s*40|255,\s*165,\s*61)/, 'mk-yellow'],
  [/background-color:\s*rgba?\((?:247,\s*105,\s*100|251,\s*191,\s*188)/, 'mk-red'],
  [/background-color:\s*rgba?\((?:205,\s*178,\s*250|147,\s*90,\s*246|186,\s*206,\s*253)/, 'mk-purple'],
  [/background-color:\s*rgba?\((?:98,\s*210,\s*86|183,\s*237,\s*177)/, 'mk-green'],
  [/background-color:\s*rgba?\((?:222,\s*224,\s*227|242,\s*243,\s*245|187,\s*191,\s*196)/, 'mk-gray'],
];
function normalizeSpans(html) {
  return html.replace(/<span style="([^"]*)">/g, (_, st) => {
    const cls = SPAN_CLASS.filter(([re]) => re.test(st)).map(([, c]) => c);
    return cls.length ? `<span class="${cls.join(' ')}">` : '<span>';
  });
}
const isRed = (raw) => /color:\s*rgb\(216,\s*57,\s*49\)/.test(raw);

// ---------------- 源文件切分 ----------------
// 返回 [{ level, title, raw, line, body: [行...] }],忽略代码块里的 #
function splitHeadings(text) {
  const lines = text.split('\n');
  const out = [];
  let cur = { level: 0, title: '', raw: '', line: 0, body: [] };
  let fence = null;
  lines.forEach((ln, i) => {
    const f = ln.match(/^\s*(```+|~~~+)/);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      cur.body.push(ln);
      return;
    }
    const h = !fence && ln.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      out.push(cur);
      cur = { level: h[1].length, title: cleanTitle(h[2]), raw: h[2], line: i + 1, body: [] };
    } else cur.body.push(ln);
  });
  out.push(cur);
  return out;
}

// 原线上站 build 里做过的修正:几个本该是 #### 的标题在原文里写成了 #
// 原笔记里的章节分隔表情包 / 动图(不是知识内容)
const DECOR = /^!\[\]\(<?images\/Java八股（后端\\?\)\+Agent八股8-(?:image-(?:1|2[6-9]|3[0-2])\.png|Suggestion(?:-1)?\.gif|无字动图\.gif|不怕困难挑战困难战胜困难\.gif|2120c7db722d271188e40b023e3f657a\.jpg)>?\)\s*$/gm;
function preNotes(text) {
  return text.replace(DECOR, '').replace(/\n#\s*\n/g, '\n')
    .replace(/^# (add_conditional_edges绑定路由函数|MCP Server 侧（用Python SDK）|触发辅助（可选）|输入参数（JSON Schema）|执行器|权限|输出（可选）)$/gm, '#### $1');
}

function chapterTopic(srcId, title) {
  for (const [s, re, topic] of CHAPTER_MAP) if (s === srcId && re.test(title)) return { matched: true, topic };
  return { matched: false };
}

const tierOf = (title) => (/\(高频\)|（高频）/.test(title) ? 'high' : /\(扩展\)|（扩展）/.test(title) ? 'ext' : null);

// 把一个章节的标题树切成题目
function chapterToQuestions(heads, ctx) {
  // heads: 章节下所有标题节点(不含章节本身),body 为该标题到下一个标题之间的内容
  const qs = [];
  // 计算每个节点是否有「题目级」子节点:子节点 level 在 (自身, 自身+2] 且 <= 3
  const n = heads.length;
  for (let i = 0; i < n; i++) {
    const h = heads[i];
    let hasChildQ = false;
    for (let j = i + 1; j < n && heads[j].level > h.level; j++) {
      if (heads[j].level <= 3) { hasChildQ = true; break; }
    }
    h.isGroup = hasChildQ && h.level < 4;
  }
  let group = null;
  for (let i = 0; i < n; i++) {
    const h = heads[i];
    if (h.isGroup) { group = h.title; continue; }
    // 问句形式的 ####(以 ？ 结尾)是独立的题,如「分代回收」下的「JVM堆内存分为几个部分？」
    const isQ4 = h.level === 4 && /[？?]$/.test(h.title);
    if (isQ4 && qs.length) {
      // 父题 = 最近一个 level<4 的题;连续几个 #### 问句是兄弟,共用同一个父题
      const parent = [...qs].reverse().find((x) => !x.isSub);
      const g = parent ? (parent.group ? `${parent.group} · ${parent.title}` : parent.title) : group;
      qs.push({ title: h.title, raw: h.raw, group: g, md: h.body.join('\n'), line: h.line, isSub: true, ...ctx });
      continue;
    }
    if (h.level >= 4 && qs.length && !h.isGroup) {
      // #### 等:并入上一题,作为答案里的小标题
      const last = qs[qs.length - 1];
      last.md += `\n\n#### ${h.raw}\n` + h.body.join('\n');
      continue;
    }
    qs.push({ title: h.title, raw: h.raw, group, md: h.body.join('\n'), line: h.line, ...ctx });
  }
  return qs;
}

// PDF 题目标题后的「（追问）」等不处理;题目里残留的序号去掉
const stripNum = (t) => t.replace(/^\s*(\d+[.、．)]|[（(]?\d+[)）])\s*/, '')
  .replace(/^["“”]+|["“”]+$/g, '').replace(/["“”]+(?=[（(])/g, '').replace(/""/g, '"').trim();

function parseSource(src) {
  let text = fs.readFileSync(path.join(ROOT, 'sources', src.file), 'utf8').replace(/^⭐+\s*$/gm, '');
  if (src.id === 'notes') text = preNotes(text);
  const heads = splitHeadings(text);
  const chapterLevel = src.id === 'bank' || src.id === 'aikb' ? 2 : 1;
  const chapters = [];
  let cur = null;
  for (const h of heads) {
    if (h.level === 0) continue;
    if (h.level <= chapterLevel) {
      if (h.level < chapterLevel) continue; // PDF 文档标题
      const t = chapterTopic(src.id, h.title);
      if (!t.matched) throw new Error(`[${src.id}] 未映射的章节:「${h.title}」(第 ${h.line} 行),请在 scripts/topics.cjs 的 CHAPTER_MAP 里补上`);
      cur = { title: h.title, topic: t.topic, tier: tierOf(h.title), intro: h.body.join('\n'), heads: [] };
      chapters.push(cur);
    } else if (cur) cur.heads.push(h);
  }
  const out = [];
  for (const ch of chapters) {
    if (!ch.topic) continue;
    const qs = chapterToQuestions(ch.heads, { source: src.id, chapter: ch.title, tier: ch.tier });
    // 章节没有任何题目(如「扩展」只有图片),整个章节当一题
    if (!qs.length && ch.intro.trim()) qs.push({ title: ch.title, raw: ch.title, group: null, md: ch.intro, source: src.id, chapter: ch.title, tier: ch.tier });
    // 章节标题和第一题之间的导语/图(如原笔记 Agent 范式的总览图)作为一条「章节概览」保留
    else if (qs.length && ch.intro.replace(/[\s⭐]+/g, '').length > 0) qs.unshift({ title: `${ch.title} · 概览`, raw: '', group: null, md: ch.intro, source: src.id, chapter: ch.title, tier: ch.tier, intro: true });
    for (const q of qs) q.topic = ch.topic;
    out.push(...qs);
  }
  return out;
}

// ---------------- overlays:纠正 / 补充 / 自测 ----------------
// overlays/<topic>.md 格式:
//   ## 纠正: <题目关键字>          -> 挂到标题包含该关键字的题目下面(可多个)
//   ## 补充: <题目关键字>
//   ## 自测                       -> 本主题的自测问答,下面用 ### 问题 + 答案
//   ## 导读                       -> 主题页顶部的学习导读
function parseOverlay(topic) {
  const f = path.join(ROOT, 'overlays', `${topic}.md`);
  if (!fs.existsSync(f)) return null;
  const heads = splitHeadings(fs.readFileSync(f, 'utf8'));
  const ov = { fixes: [], adds: [], quiz: [], guide: '' };
  let mode = null;
  for (const h of heads) {
    if (h.level === 2) {
      const m = h.title.match(/^(纠正|补充)\s*[:：]\s*(.+)$/);
      if (m) { (m[1] === '纠正' ? ov.fixes : ov.adds).push({ key: m[2].trim(), html: md.render(h.body.join('\n')) }); mode = null; continue; }
      if (/^自测/.test(h.title)) { mode = 'quiz'; continue; }
      if (/^导读/.test(h.title)) { ov.guide = md.render(h.body.join('\n')); mode = null; continue; }
      throw new Error(`overlays/${topic}.md:未知的二级标题「${h.title}」`);
    } else if (h.level === 3 && mode === 'quiz') {
      ov.quiz.push({ q: h.title, a: md.render(h.body.join('\n')) });
    }
  }
  return ov;
}

// ---------------- 真题清单 ----------------
function parseReal() {
  const f = path.join(ROOT, 'overlays', 'real-questions.md');
  if (!fs.existsSync(f)) return [];
  const items = [];
  for (const ln of fs.readFileSync(f, 'utf8').split('\n')) {
    // 格式:N. 题目 | 主题id[,主题id] | 题目关键字(可选,用来定位到具体题)
    const m = ln.match(/^(\d+)\.\s*(.+?)\s*\|\s*([\w,-]+)\s*(?:\|\s*(.+))?$/);
    if (m) items.push({ n: +m[1], q: m[2], topics: m[3].split(','), key: m[4] || '' });
  }
  return items;
}

// ---------------- 主流程 ----------------
// 供 check-overlay 使用:只解析,返回 { topic: [标题...] },不写任何文件
function titlesByTopic() {
  const out = {};
  for (const src of SOURCES) for (const q of parseSource(src)) {
    for (const [from, re, to] of REROUTE) if (q.topic === from && re.test(q.title)) { q.topic = to; break; }
    const t = splitCompanies(stripNum(q.title)).title.replace(/["“”]+$/g, '').trim();
    (out[q.topic] = out[q.topic] || []).push(t);
  }
  return out;
}
// 供重写使用:导出每个内部主题的全部题目原始 markdown
function questionsByTopic() {
  const out = {};
  for (const src of SOURCES) for (const q of parseSource(src)) {
    for (const [from, re, to] of REROUTE) if (q.topic === from && re.test(q.title)) { q.topic = to; break; }
    const sc = splitCompanies(stripNum(q.title));
    (out[q.topic] = out[q.topic] || []).push({ title: sc.title.replace(/["“”]+$/g, '').trim(), companies: sc.companies, core: isRed(q.raw), tier: q.tier, group: q.group, md: q.md });
  }
  return out;
}
module.exports = { titlesByTopic, questionsByTopic };

function main() {
  const topicIds = new Set(TOPICS.map((t) => t.id));
  let all = [];
  for (const src of SOURCES) all.push(...parseSource(src));

  // 题目二次分流 + 清洗
  for (const q of all) {
    for (const [from, re, to] of REROUTE) if (q.topic === from && re.test(q.title)) { q.topic = to; break; }
    if (!topicIds.has(q.topic)) throw new Error(`未知主题 ${q.topic}`);
    q.title = stripNum(q.title);
    const sc = splitCompanies(q.title);
    q.title = sc.title.replace(/["“”]+$/g, '').trim();
    q.companies = sc.companies;
    q.core = isRed(q.raw); // 原资料标红 = 核心高频
  }
  all = all.filter((q) => q.title && (q.md.trim() || q.source === 'notes'));

  // 生成稳定 id:主题-源-序号
  const counters = {};
  for (const q of all) {
    const k = `${q.topic}:${q.source}`;
    counters[k] = (counters[k] || 0) + 1;
    q.id = `${q.topic}.${q.source}.${counters[k]}`;
  }

  // ---------- 输出:每个大块一个 HTML 片段,章节平铺 ----------
  const OUT = path.join(ROOT, 'data');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const escH = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const srcShort = Object.fromEntries(SOURCES.map((x) => [x.id, x.short]));
  const usedOv = new Set();
  const overlays = Object.fromEntries(TOPICS.map((t) => [t.id, parseOverlay(t.id)]));
  const nav = [];
  const search = [];
  let qn = 0;
  const realItems = parseReal();
  const missReal = [];
  const topicSection = {};
  for (const part of PARTS) for (const sec of part.sections) for (const t of sec.topics) topicSection[t] = { part: part.id, sec: sec.id };

  for (const part of PARTS) {
    let html = '';
    const navSecs = [];
    for (const sec of part.sections) {
      if (sec.id === 'real') continue;
      const qs = all.filter((q) => sec.topics.includes(q.topic));
      const guides = sec.topics.map((t) => overlays[t] && overlays[t].guide).filter(Boolean);
      const quiz = sec.topics.flatMap((t) => (overlays[t] ? overlays[t].quiz : []));
      html += `<section class="sec" id="${sec.id}"><h2 class="sec-title">${escH(sec.title)} <span class="cnt">${qs.length}</span></h2>`;
      if (guides.length) html += `<div class="guide">${guides.join('')}</div>`;
      // 按来源分小节,来源内按原分组
      for (const src of SOURCES) {
        const sq = qs.filter((q) => q.source === src.id);
        if (!sq.length) continue;
        html += `<h3 class="src-title">${escH(src.label)} <span class="cnt">${sq.length}</span></h3>`;
        let g;
        for (const q of sq) {
          if (q.group && q.group !== g) html += `<h4 class="grp">${escH(q.group)}</h4>`;
          g = q.group;
          const ov = overlays[q.topic];
          const fixes = ov ? ov.fixes.filter((f) => q.title.includes(f.key)) : [];
          const adds = ov ? ov.adds.filter((f) => q.title.includes(f.key)) : [];
          fixes.forEach((f) => usedOv.add(`${q.topic}:纠正:${f.key}`));
          adds.forEach((f) => usedOv.add(`${q.topic}:补充:${f.key}`));
          const id = `q${++qn}`;
          q.anchor = id; q.part = part.id;
          const tags = [
            q.core ? '<i class="t-core">核心</i>' : '',
            ...q.companies.map((c) => `<i class="t-co${isBank(c) ? ' bank' : ''}">${escH(c)}</i>`),
          ].join('');
          html += `<div class="q" id="${id}"><h5>${escH(q.title)}${tags}</h5>`;
          for (const f of fixes) html += `<div class="fix"><b>纠正</b>${f.html}</div>`;
          html += `<div class="a">${normalizeSpans(md.render(q.md))}</div>`;
          for (const f of adds) html += `<div class="add"><b>补充</b>${f.html}</div>`;
          html += '</div>';
          search.push([id, part.id, q.title, sec.title]);
        }
      }
      if (quiz.length) {
        html += `<h3 class="src-title">自测问答 <span class="cnt">${quiz.length}</span></h3><div class="quiz">`;
        for (const x of quiz) html += `<div class="qa"><p class="qq">${escH(x.q)}</p>${x.a}</div>`;
        html += '</div>';
      }
      html += '</section>';
      navSecs.push({ id: sec.id, title: sec.title, n: qs.length });
    }
    if (part.id === 'more' && realItems.length) {
      html += '<section class="sec" id="real"><h2 class="sec-title">114 道真题清单</h2><ol class="real">';
      for (const r of realItems) {
        const hit = r.key ? all.find((q) => r.topics.includes(q.topic) && q.title.includes(r.key)) : null;
        if (r.key && !hit) missReal.push(`#${r.n} ${r.q} ← 「${r.key}」`);
        const links = r.topics.map((t) => {
          const ts = topicSection[t]; const sec = PARTS.find((p) => p.id === ts.part).sections.find((x) => x.id === ts.sec);
          return `<a href="${ts.part}.html#${ts.sec}">${escH(sec.title)}</a>`;
        });
        if (hit) links.unshift(`<a href="${hit.part}.html#${hit.anchor}">直达</a>`);
        html += `<li value="${r.n}">${escH(r.q)} <span class="links">${links.join('')}</span></li>`;
      }
      html += '</ol></section>';
      navSecs.push({ id: 'real', title: '114 道真题清单', n: realItems.length });
    }
    nav.push({ id: part.id, title: part.title, sections: navSecs });
    fs.writeFileSync(path.join(OUT, `${part.id}.html`), html);
  }
  for (const t of TOPICS) {
    const ov = overlays[t.id];
    if (!ov) continue;
    for (const [kind, list] of [['纠正', ov.fixes], ['补充', ov.adds]]) for (const f of list) {
      if (!usedOv.has(`${t.id}:${kind}:${f.key}`)) throw new Error(`overlays/${t.id}.md:「${kind}: ${f.key}」没有匹配到任何题目`);
    }
  }
  if (missReal.length) { console.error(`✗ 真题关键字没匹配到题目:\n  ${missReal.join('\n  ')}`); process.exitCode = 1; }
  fs.writeFileSync(path.join(OUT, 'nav.json'), JSON.stringify({ parts: nav, search, total: all.length }));

  // 生成三个页面
  const tpl = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8');
  for (const part of nav) {
    const body = fs.readFileSync(path.join(OUT, `${part.id}.html`), 'utf8');
    const page = tpl.replace('<!-- PART -->', part.id).replace('<!-- TITLE -->', escH(part.title)).replace('<!-- CONTENT -->', body);
    fs.writeFileSync(path.join(ROOT, `${part.id}.html`), page);
  }
  // 报告
  console.log(`✓ ${all.length} 题`);
  for (const p of nav) console.log(`  ${p.title}: ${p.sections.map((x) => `${x.title} ${x.n}`).join(' · ')}`);
}

if (require.main === module) main();
