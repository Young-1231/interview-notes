// 构建独立专题页「Agent 后端工程」:guide/agent-backend/*.md -> agent-backend.html
//   node scripts/build-guide.cjs
// 与八股站的 content/ 和 build.cjs 互不依赖;只复用 style.css 的配色和排版
// 章节格式见 scripts/check-guide.cjs;正文里的 <!-- svg:name --> 会替换成 guide/diagrams/name.svg
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MarkdownIt = require('./vendor/markdown-it.js');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'guide', 'agent-backend');
const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
const TAG = { 必学: 'must', 按需: 'need', 进阶: 'adv' };

const files = fs.readdirSync(DIR).filter((f) => /^\d\d-.+\.md$/.test(f)).sort();
const toc = [];
let html = '';
for (const f of files) {
  let src = fs.readFileSync(path.join(DIR, f), 'utf8');
  // SVG 在 markdown 渲染之后再插入:SVG 里的空行会打断 markdown-it 的 HTML 块
  const svgs = [];
  src = src.replace(/<!--\s*svg:([\w-]+)\s*-->/g, (_, n) => {
    const p = path.join(ROOT, 'guide', 'diagrams', `${n}.svg`);
    if (!fs.existsSync(p)) throw new Error(`${f}: 找不到图 ${n}.svg`);
    svgs.push(fs.readFileSync(p, 'utf8').trim());
    return `\n\nSVGSLOT${svgs.length - 1}\n\n`;
  });
  let out = md.render(src).replace(/<p>SVGSLOT(\d+)<\/p>/g, (_, i) => `<figure class="diagram">${svgs[+i]}</figure>`);
  let chap = null, k = 0;
  out = out.replace(/<h2>([\s\S]*?)<\/h2>/, (_, inner) => {
    const m = strip(inner).match(/^(\d+)\.\s*(.+?)\s*\{(必学|按需|进阶)\}$/);
    if (!m) throw new Error(`${f}: 章标题格式不对`);
    chap = { id: `c${m[1]}`, no: m[1], title: m[2], tag: m[3], secs: [] };
    toc.push(chap);
    return `<h2 class="ch-title" id="${chap.id}"><span class="no">${m[1]}</span>${esc(m[2])}<i class="tag ${TAG[m[3]]}">${m[3]}</i></h2>`;
  });
  out = out.replace(/<h3>([\s\S]*?)<\/h3>/g, (_, inner) => {
    const id = `${chap.id}-${++k}`;
    const t = strip(inner);
    chap.secs.push({ id, title: t });
    const cls = t === '自测' ? ' class="quiz-h"' : t === '生产环境怎么做' ? ' class="prod-h"' : '';
    return `<h3 id="${id}"${cls}>${inner}</h3>`;
  });
  // 章首的一句话引用块
  out = out.replace(/<blockquote>/, '<blockquote class="gist">');
  html += `<section class="chapter" data-tag="${TAG[chap.tag]}">${out}</section>\n`;
}

const VER = crypto.createHash('md5').update(html)
  .update(fs.readFileSync(path.join(ROOT, 'assets', 'style.css'))).update(fs.readFileSync(path.join(ROOT, 'assets', 'guide.css'))).update(fs.readFileSync(path.join(ROOT, 'assets', 'guide.js')))
  .digest('hex').slice(0, 8);
const tpl = fs.readFileSync(path.join(ROOT, 'guide', 'template.html'), 'utf8');
const page = tpl.replaceAll('<!-- V -->', VER)
  .replace('<!-- TOC -->', JSON.stringify(toc).replace(/</g, '\\u003c'))
  .replace('<!-- CONTENT -->', html);
fs.writeFileSync(path.join(ROOT, 'agent-backend.html'), page);
console.log(`✓ agent-backend.html · ${toc.length} 章 · ${toc.reduce((s, c) => s + c.secs.length, 0)} 节`);
for (const c of toc) console.log(`  ${c.no}. ${c.title} [${c.tag}] ${c.secs.length} 节`);
