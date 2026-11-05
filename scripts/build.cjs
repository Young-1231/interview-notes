// 构建八股站:content/*.md(统一稿) -> 每个章节一个页面 + data/nav.json
//   node scripts/build.cjs
// 统一稿格式:## 子分组 / ### 题目 | 高频 | 公司、公司 / 答案 markdown(见 scripts/check-content.cjs)
// 站点结构:scripts/site.cjs
const fs = require('fs');
const path = require('path');
const MarkdownIt = require('./vendor/markdown-it.js');
const SITE = require('./site.cjs');

const ROOT = path.resolve(__dirname, '..');
const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isBank = (c) => /银行|工行|农行|建行|交行|中行|邮储|招行/.test(c);

// 一个章节可能由多个文件组成,大主题拆成 <file>-1.md、<file>-2.md ... 按序拼接
function filesOf(id) {
  const dir = path.join(ROOT, 'content');
  if (fs.existsSync(path.join(dir, `${id}.md`))) return [path.join(dir, `${id}.md`)];
  const parts = [];
  for (let n = 1; fs.existsSync(path.join(dir, `${id}-${n}.md`)); n++) parts.push(path.join(dir, `${id}-${n}.md`));
  return parts;
}

// 解析统一稿 -> [{ title, qs: [{ title, core, companies, md }] }]
function parse(text, file) {
  const groups = [];
  let g = null, q = null, fence = false;
  for (const ln of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(ln)) fence = !fence;
    const h = !fence && ln.match(/^(##|###)\s+(.+?)\s*$/);
    if (h && h[1] === '##') {
      // 拆分文件之间同名分组接续
      const last = groups[groups.length - 1];
      g = last && last.title === h[2] ? last : { title: h[2], qs: [] };
      if (g !== last) groups.push(g);
      q = null;
    } else if (h) {
      if (!g) throw new Error(`${file}: 题目「${h[2]}」在 ## 子分组之前`);
      const [title, ...tags] = h[2].split(/\s+\|\s+/);
      q = { title: title.trim(), core: false, companies: [], md: [] };
      for (const t of tags) {
        if (/^(高频|核心)$/.test(t.trim())) q.core = true;
        else q.companies.push(...t.split(/[、,，]/).map((x) => x.trim()).filter(Boolean));
      }
      g.qs.push(q);
    } else if (q) q.md.push(ln);
  }
  if (fence) throw new Error(`${file}: 代码块没有闭合`);
  return groups;
}

// 静态资源版本号:内容变化后浏览器不用强刷
const VER = require('crypto').createHash('md5')
  .update(fs.readFileSync(path.join(ROOT, 'assets/style.css'))).update(fs.readFileSync(path.join(ROOT, 'assets/app.js'))).digest('hex').slice(0, 8);

function main() {
  const tpl = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8');
  const nav = [];       // 给前端:全站目录
  const search = [];    // 给前端:全站题目搜索 [标题, 页面, 锚点, 章节]
  const pages = [];
  let total = 0;
  const missing = [];

  for (const part of SITE) {
    const navPart = { id: part.id, title: part.title, sections: [] };
    for (const sec of part.sections) {
      // 章节 -> 若干 block(多文件章节每个文件一个 block,带小标题)
      const blocks = [];
      for (const f of sec.files) {
        const paths = filesOf(f);
        if (!paths.length) { missing.push(f); continue; }
        const groups = [];
        for (const p of paths) {
          for (const g of parse(fs.readFileSync(p, 'utf8'), path.relative(ROOT, p))) {
            const last = groups[groups.length - 1];
            if (last && last.title === g.title) last.qs.push(...g.qs); else groups.push(g);
          }
        }
        // 有 fileTitles 的文件单独成块(带小标题);没有的视为上一块的续篇
        const named = sec.fileTitles && sec.fileTitles[f];
        if (blocks.length && !named) blocks[blocks.length - 1].groups.push(...groups);
        else blocks.push({ title: named || sec.title, groups });
      }
      if (!blocks.length) continue;
      if (blocks.length === 1) blocks[0].title = null;
      pages.push({ part, sec, blocks });
      const n = sec.unit ? blocks.reduce((s, b) => s + b.groups.length, 0) : blocks.reduce((s, b) => s + b.groups.reduce((t, g) => t + g.qs.length, 0), 0);
      navPart.sections.push({ id: sec.id, title: sec.title, n });
      if (!sec.unit) total += n;
    }
    nav.push(navPart);
  }

  for (const [pi, { part, sec, blocks }] of pages.entries()) {
    let html = '', gi = 0, qi = 0;
    const outline = []; // 侧栏:当前章节的子分组
    const all = blocks.flatMap((b) => b.groups.flatMap((g) => g.qs));
    const nGroups = blocks.reduce((s, b) => s + b.groups.length, 0);
    const nCore = all.filter((q) => q.core).length;
    html += `<header class="page-head"><div class="crumb">${esc(part.title)}</div><h1>${esc(sec.title)} <span class="cnt">${sec.unit ? `${nGroups} ${sec.unit}` : `${all.length} 题`}</span></h1>`;
    // 学习工具:只看高频 / 自测(隐藏答案) / 继续上次;面经页没有标准答案,不放
    if (!sec.unit) html += '<div class="tools">' +
      (nCore ? `<button type="button" class="tool" id="t-core" aria-pressed="false">只看高频 <b>${nCore}</b></button>` : '') +
      '<button type="button" class="tool" id="t-quiz" aria-pressed="false">自测模式</button>' +
      '<a class="tool resume" id="t-resume" hidden></a>' +
      '<span class="kbd-hint"><kbd>j</kbd>/<kbd>k</kbd> 上下题 · 自测时 <kbd>空格</kbd> 看答案 · <kbd>/</kbd> 搜索</span></div>';
    // 页首:分组速览,一眼看到本章结构
    html += '<nav class="overview">';
    let og = 0;
    for (const b of blocks) {
      if (b.title) html += `<div class="ov-block">${esc(b.title)}</div>`;
      html += '<div class="ov-groups">' + b.groups.map((g) => `<a href="#g${++og}"${g.qs.some((q) => q.core) ? '' : ' class="no-core"'}>${esc(g.title)}${sec.unit ? '' : `<span><span class="n-all">${g.qs.length}</span><span class="n-core">${g.qs.filter((q) => q.core).length}</span></span>`}</a>`).join('') + '</div>';
    }
    html += '</nav></header>';

    for (const b of blocks) {
      if (b.title) {
        html += `<h2 class="block-title">${esc(b.title)}</h2>`;
        outline.push({ block: b.title });
      }
      for (const g of b.groups) {
        const gid = `g${++gi}`;
        outline.push({ id: gid, title: g.title, n: sec.unit ? '' : g.qs.length, core: g.qs.filter((q) => q.core).length });
        if (sec.unit) search.push([g.title, sec.id, gid, sec.title]);
        const gc = g.qs.some((q) => q.core) ? ' has-core' : '';
        html += `<section class="grp${gc}" id="${gid}"><h2 class="grp-title">${esc(g.title)} ${sec.unit ? '' : `<span class="cnt"><span class="n-all">${g.qs.length}</span><span class="n-core">高频 ${g.qs.filter((q) => q.core).length}</span></span>`}</h2>`;
        for (const q of g.qs) {
          const id = `q${++qi}`;
          const tags = (q.core ? '<i class="t-core">高频</i>' : '') +
            q.companies.map((c) => `<i class="t-co${isBank(c) ? ' bank' : ''}">${esc(c)}</i>`).join('');
          html += `<article class="q${q.core ? ' core' : ''}" id="${id}"><h3><a class="q-link" href="#${id}">${esc(q.title)}</a>${tags ? `<span class="tags">${tags}</span>` : ''}</h3>`;
          let body = md.render(q.md.join('\n')).trim();
          // 首段是一句短结论时高亮,方便速览「先说结论」
          const fp = body.match(/^<p>([\s\S]*?)<\/p>/);
          if (fp && fp[1].replace(/<[^>]+>/g, '').length <= 200) body = body.replace(/^<p>/, '<p class="lead">');
          html += `<div class="a">${body}</div></article>`;
          if (!sec.unit) search.push([q.title, sec.id, id, sec.title]);
        }
        html += '</section>';
      }
    }
    // 上一章 / 下一章
    const prev = pages[pi - 1], next = pages[pi + 1];
    html += '<nav class="pager">' +
      (prev ? `<a href="${prev.sec.id}.html" class="prev"><small>上一章</small>${esc(prev.sec.title)}</a>` : '<span></span>') +
      (next ? `<a href="${next.sec.id}.html" class="next"><small>下一章</small>${esc(next.sec.title)}</a>` : '<span></span>') + '</nav>';

    const page = tpl.replaceAll('<!-- V -->', VER).replaceAll('<!-- PART -->', part.id).replaceAll('<!-- SEC -->', sec.id)
      .replace('<!-- TITLE -->', esc(sec.title))
      .replace('<!-- OUTLINE -->', JSON.stringify(outline).replace(/</g, '\\u003c'))
      .replace('<!-- CONTENT -->', html);
    fs.writeFileSync(path.join(ROOT, `${sec.id}.html`), page);
  }

  // 清理旧版生成的页面
  for (const old of ['java.html', 'ai.html', 'more.html']) fs.rmSync(path.join(ROOT, old), { force: true });
  const OUT = path.join(ROOT, 'data');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const core = pages.reduce((s, p) => s + p.blocks.reduce((t, b) => t + b.groups.reduce((u, g) => u + g.qs.filter((q) => q.core).length, 0), 0), 0);
  fs.writeFileSync(path.join(OUT, 'nav.json'), JSON.stringify({ parts: nav, search, total, core }));

  const idx = path.join(ROOT, 'index.html');
  fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace(/(assets\/(?:style\.css|app\.js))\?v=[^"]*/g, `$1?v=${VER}`));
  console.log(`✓ ${pages.length} 个章节 · ${total} 题`);
  for (const p of nav) console.log(`  ${p.title}: ${p.sections.map((x) => `${x.title} ${x.n}`).join(' · ')}`);
  if (missing.length) console.log(`  (还没有内容:${missing.join(', ')})`);
}

main();
