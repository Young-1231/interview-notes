// 八股笔记:每个章节一页。左侧 = 本大块的章节,当前章节展开到子分组;顶部搜索全站题目,也可在本页全文查找
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const part = document.body.dataset.part;
  const secId = document.body.dataset.sec;
  const article = $('#article');
  const outline = JSON.parse(($('#outline') || {}).textContent || '[]');

  // ---------- 主题 ----------
  $('#theme-toggle').addEventListener('click', () => {
    const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('iv.theme', t);
  });

  // ---------- 顶栏 + 侧栏 ----------
  let nav = null;
  fetch('data/nav.json').then((r) => r.json()).then((n) => {
    nav = n;
    $('#tabs').innerHTML = nav.parts.map((p) => `<a href="${p.sections[0].id}.html" class="${p.id === part ? 'active' : ''}">${esc(p.title)}</a>`).join('');
    const cur = nav.parts.find((p) => p.id === part);
    if (!cur) return;
    $('#toc').innerHTML = cur.sections.map((s) => {
      if (s.id !== secId) return `<a class="toc-sec" href="${s.id}.html">${esc(s.title)}<span>${s.n}</span></a>`;
      const sub = outline.map((o) => (o.block
        ? `<div class="toc-block">${esc(o.block)}</div>`
        : `<a class="toc-grp" href="#${o.id}" data-g="${o.id}">${esc(o.title)}<span>${o.n}</span></a>`)).join('');
      return `<a class="toc-sec cur" href="#">${esc(s.title)}<span>${s.n}</span></a><div class="toc-sub">${sub}</div>`;
    }).join('');
    spy();
    if (typeof updateCounts === 'function') updateCounts();
    const a = $('#toc .cur');
    if (a) a.scrollIntoView({ block: 'center' });
  });

  // 侧栏高亮当前子分组
  function spy() {
    const links = [...document.querySelectorAll('#toc .toc-grp')];
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) links.forEach((a) => a.classList.toggle('active', a.dataset.g === e.target.id));
    }, { rootMargin: '-10% 0px -85% 0px' });
    document.querySelectorAll('.grp').forEach((s) => io.observe(s));
    document.querySelectorAll('#toc a').forEach((a) => a.addEventListener('click', () => document.body.classList.remove('side-open')));
  }

  // ---------- 移动端目录 / 回到顶部 ----------
  $('#menu-btn').addEventListener('click', () => document.body.classList.toggle('side-open'));
  $('#backdrop').addEventListener('click', () => document.body.classList.remove('side-open'));
  const top = $('#to-top');
  addEventListener('scroll', () => top.classList.toggle('show', scrollY > 800), { passive: true });
  top.addEventListener('click', () => scrollTo({ top: 0 }));

  // ---------- 图片懒加载 + 点击放大;代码复制 ----------
  article.querySelectorAll('img').forEach((img) => { img.loading = 'lazy'; img.decoding = 'async'; });
  article.querySelectorAll('pre').forEach((pre) => {
    const b = document.createElement('button');
    b.className = 'copy'; b.type = 'button'; b.textContent = '复制';
    pre.append(b);
  });
  article.addEventListener('click', (e) => {
    const cp = e.target.closest('.copy');
    if (cp) {
      const code = cp.parentElement.querySelector('code') || cp.parentElement;
      navigator.clipboard && navigator.clipboard.writeText(code.innerText);
      cp.textContent = '已复制'; setTimeout(() => (cp.textContent = '复制'), 1200);
      return;
    }
    const img = e.target.closest('.a img');
    if (img) {
      const box = document.createElement('div');
      box.className = 'lightbox';
      box.innerHTML = `<img src="${img.currentSrc || img.src}" alt="">`;
      box.addEventListener('click', () => box.remove());
      document.body.append(box);
    }
  });
  article.querySelectorAll('.a a[href^="http"]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });

  // ---------- 学习工具:只看高频 / 自测模式 / 继续上次 ----------
  const qs = [...article.querySelectorAll('.q')];
  const store = {
    get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  };
  function setMode(name, on) {
    document.body.classList.toggle(name, on);
    const b = $(`#t-${name.replace('only-', '')}`);
    if (b) b.setAttribute('aria-pressed', on);
    store.set(`iv.${name}`, on);
    if (name === 'only-core') updateCounts();
  }
  function updateCounts() {
    const on = document.body.classList.contains('only-core');
    document.querySelectorAll('#toc .toc-grp').forEach((a) => {
      const o = outline.find((x) => x.id === a.dataset.g);
      if (o && o.n !== '') { a.querySelector('span').textContent = on ? o.core : o.n; a.hidden = on && !o.core; }
    });
  }
  const tCore = $('#t-core'), tQuiz = $('#t-quiz');
  if (tCore) tCore.addEventListener('click', () => setMode('only-core', !document.body.classList.contains('only-core')));
  if (tQuiz) {
    tQuiz.addEventListener('click', () => setMode('quiz', !document.body.classList.contains('quiz')));
    // 自测:每题一个「看答案」按钮,先自己想,再展开对照
    qs.forEach((q) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'reveal'; b.textContent = '看答案';
      q.querySelector('h3').after(b);
    });
    article.addEventListener('click', (e) => {
      const b = e.target.closest('.reveal');
      if (b) { const q = b.closest('.q'); q.classList.toggle('open'); b.textContent = q.classList.contains('open') ? '收起答案' : '看答案'; }
    });
  }
  if (tCore && store.get('iv.only-core')) setMode('only-core', true);
  if (tQuiz && store.get('iv.quiz')) setMode('quiz', true);

  // 阅读位置:记住每页读到哪一题;回到本页时提示「继续上次」,首页提示最近一次
  const posKey = `iv.pos.${secId}`;
  const saved = store.get(posKey);
  const resume = $('#t-resume');
  if (resume && saved && !location.hash && saved.id !== (qs[0] && qs[0].id) && document.getElementById(saved.id)) {
    resume.hidden = false;
    resume.href = `#${saved.id}`;
    resume.innerHTML = `继续上次:<span>${esc(saved.title)}</span>`;
    resume.addEventListener('click', () => (resume.hidden = true));
  }
  let posT;
  addEventListener('scroll', () => {
    clearTimeout(posT);
    posT = setTimeout(() => {
      const q = qs.find((x) => x.offsetParent && x.getBoundingClientRect().bottom > 120);
      if (!q) return;
      const v = { id: q.id, title: q.querySelector('h3 a').textContent, sec: secId, secTitle: document.title.split(' · ')[0] };
      store.set(posKey, v); store.set('iv.last', v);
    }, 400);
  }, { passive: true });

  // 键盘:j / k 下一题 / 上一题;自测模式下 空格 展开当前题
  let curQ = -1;
  const visibleQs = () => qs.filter((x) => x.offsetParent);
  function nearest() {
    const v = visibleQs();
    const i = v.findIndex((x) => x.getBoundingClientRect().top > 100);
    return { v, i: i < 0 ? v.length : i };
  }
  document.addEventListener('keydown', (e) => {
    if ((e.target.closest && e.target.closest('input, textarea')) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'j' || e.key === 'k') {
      const { v, i } = nearest();
      const j = e.key === 'j' ? i : Math.max(0, i - 2);
      if (v[j]) { v[j].scrollIntoView({ block: 'start' }); curQ = qs.indexOf(v[j]); }
    } else if (e.key === ' ' && document.body.classList.contains('quiz')) {
      const { v, i } = nearest();
      const q = qs[curQ] && qs[curQ].offsetParent && Math.abs(qs[curQ].getBoundingClientRect().top) < innerHeight ? qs[curQ] : v[Math.max(0, i - 1)];
      if (q) { e.preventDefault(); q.querySelector('.reveal').click(); }
    }
  });

  // ---------- 搜索:下拉列出全站匹配的题目;选「本页全文」则高亮并用回车逐个跳 ----------
  const input = $('#search');
  const info = $('#search-info');
  const pop = $('#search-pop');
  let items = [], sel = 0, marks = [], cur = -1, fullMode = false;

  function renderPop(q) {
    if (!q || !nav) { pop.hidden = true; return; }
    const ql = q.toLowerCase();
    const hits = nav.search.filter((x) => x[0].toLowerCase().includes(ql)).slice(0, 30);
    items = [{ full: true }, ...hits.map((h) => ({ href: `${h[1]}.html#${h[2]}`, title: h[0], sec: h[3] }))];
    sel = hits.length ? 1 : 0;
    pop.innerHTML = items.map((it, i) => (it.full
      ? `<a data-i="${i}" class="full">在本页全文查找「${esc(q)}」<small>回车跳下一处</small></a>`
      : `<a data-i="${i}" href="${it.href}">${esc(it.title)}<small>${esc(it.sec)}</small></a>`)).join('') +
      (hits.length ? '' : '<div class="none">没有匹配的题目</div>');
    pop.hidden = false;
    hilite();
  }
  function hilite() { pop.querySelectorAll('a').forEach((a) => a.classList.toggle('sel', +a.dataset.i === sel)); }
  function choose(i) {
    const it = items[i];
    if (!it) return;
    if (it.full) { pop.hidden = true; fullMode = true; find(input.value.trim()); return; }
    pop.hidden = true;
    location.href = it.href;
  }
  pop.addEventListener('mousedown', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    choose(+a.dataset.i);
  });

  function clear() {
    article.querySelectorAll('mark[data-s]').forEach((m) => m.replaceWith(document.createTextNode(m.textContent)));
    article.normalize();
    marks = []; cur = -1; info.textContent = '';
  }
  function find(q) {
    clear();
    if (!q) return;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest('pre, mark, script') || !re.test(n.nodeValue) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const frag = document.createDocumentFragment();
      let last = 0;
      n.nodeValue.replace(re, (m, i) => {
        frag.append(n.nodeValue.slice(last, i));
        const mk = document.createElement('mark'); mk.dataset.s = '1'; mk.textContent = m;
        frag.append(mk); marks.push(mk); last = i + m.length;
      });
      frag.append(n.nodeValue.slice(last));
      n.replaceWith(frag);
    }
    info.textContent = marks.length ? `0/${marks.length}` : '无结果';
    if (marks.length) go(0);
  }
  function go(i) {
    if (!marks.length) return;
    if (cur >= 0) marks[cur].classList.remove('cur');
    cur = (i + marks.length) % marks.length;
    marks[cur].classList.add('cur');
    marks[cur].scrollIntoView({ block: 'center' });
    info.textContent = `${cur + 1}/${marks.length}`;
  }

  input.addEventListener('input', () => { fullMode = false; clear(); renderPop(input.value.trim()); });
  input.addEventListener('focus', () => { if (input.value.trim() && !fullMode) renderPop(input.value.trim()); });
  input.addEventListener('blur', () => setTimeout(() => (pop.hidden = true), 100));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; fullMode = false; clear(); pop.hidden = true; input.blur(); return; }
    if (fullMode) {
      if (e.key === 'Enter') { e.preventDefault(); go(cur + (e.shiftKey ? -1 : 1)); }
      return;
    }
    if (pop.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); hilite(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); hilite(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input.focus(); input.select(); }
  });
})();
