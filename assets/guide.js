// 「Agent 后端工程」专题页:目录 + 阅读进度 + 只看必学 + 代码复制。与八股站 app.js 互不依赖
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const toc = JSON.parse($('#toc-data').textContent);
  const article = $('#article');
  const TAG = { 必学: 'must', 按需: 'need', 进阶: 'adv' };

  // 主题
  $('#theme-toggle').addEventListener('click', () => {
    const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('iv.theme', t);
  });

  // 目录:章 → 节;当前章展开
  $('#toc').innerHTML = toc.map((c) => `
    <div class="g-ch" data-ch="${c.id}" data-tag="${TAG[c.tag]}">
      <a class="g-ch-a" href="#${c.id}"><span class="no">${c.no}</span><span class="t">${esc(c.title)}</span><i class="tag ${TAG[c.tag]}">${c.tag}</i></a>
      <div class="g-secs">${c.secs.map((s) => `<a href="#${s.id}" data-s="${s.id}">${esc(s.title)}</a>`).join('')}</div>
    </div>`).join('');
  const chEls = [...document.querySelectorAll('.g-ch')];
  const secLinks = [...document.querySelectorAll('.g-secs a')];
  // 当前位置 = 视口顶部之上最后一个标题(比 IntersectionObserver 更稳,跳转后也能立刻高亮)
  const heads = [...article.querySelectorAll('h2[id], h3[id]')];
  let lastId = null;
  const spy = () => {
    let cur = heads[0];
    for (const h of heads) { if (h.getBoundingClientRect().top <= 180) cur = h; else break; }
    if (!cur || cur.id === lastId) return;
    lastId = cur.id;
    const ch = cur.id.split('-')[0];
    chEls.forEach((x) => x.classList.toggle('cur', x.dataset.ch === ch));
    secLinks.forEach((a) => a.classList.toggle('active', a.dataset.s === cur.id));
    const act = document.querySelector('.g-secs a.active') || document.querySelector('.g-ch.cur');
    if (act && document.body.classList.contains('side-open') === false) {
      const side = $('#side'), r = act.getBoundingClientRect();
      if (r.top < 70 || r.bottom > innerHeight - 20) act.scrollIntoView({ block: 'nearest' });
    }
    if (scrollY > 200) localStorage.setItem('iv.guide.pos', cur.id);
  };
  let raf = 0;
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; spy(); }); }, { passive: true });
  spy();
  document.querySelectorAll('#toc a').forEach((a) => a.addEventListener('click', () => document.body.classList.remove('side-open')));

  // 阅读进度
  const prog = $('#g-progress');
  const onScroll = () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    prog.textContent = h > 0 ? `${Math.round((scrollY / h) * 100)}%` : '';
    $('#to-top').classList.toggle('show', scrollY > 800);
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  $('#to-top').addEventListener('click', () => scrollTo({ top: 0 }));

  // 回到上次位置
  const pos = localStorage.getItem('iv.guide.pos');
  if (!location.hash && pos && document.getElementById(pos) && pos !== 'c0') {
    const tip = document.createElement('a');
    tip.className = 'g-resume'; tip.href = `#${pos}`;
    const sec = toc.flatMap((c) => c.secs.map((s) => ({ ...s, ch: c }))).find((s) => s.id === pos);
    const c = toc.find((x) => x.id === pos);
    tip.innerHTML = `继续上次:<b>${esc(sec ? `${sec.ch.no}. ${sec.ch.title} · ${sec.title}` : c ? `${c.no}. ${c.title}` : '')}</b>`;
    tip.addEventListener('click', () => tip.remove());
    article.prepend(tip);
  }

  // 只看必学
  const btns = [...document.querySelectorAll('.g-filter button')];
  const setF = (f) => {
    document.body.classList.toggle('only-must', f === 'must');
    btns.forEach((b) => b.setAttribute('aria-pressed', b.dataset.f === f));
    localStorage.setItem('iv.guide.filter', f);
  };
  btns.forEach((b) => b.addEventListener('click', () => setF(b.dataset.f)));
  setF(localStorage.getItem('iv.guide.filter') || 'all');

  // 移动端目录
  $('#menu-btn').addEventListener('click', () => document.body.classList.toggle('side-open'));
  $('#backdrop').addEventListener('click', () => document.body.classList.remove('side-open'));

  // 代码复制
  article.querySelectorAll('pre').forEach((pre) => {
    const b = document.createElement('button');
    b.className = 'copy'; b.type = 'button'; b.textContent = '复制';
    pre.append(b);
  });
  article.addEventListener('click', (e) => {
    const cp = e.target.closest('.copy');
    if (!cp) return;
    const code = cp.parentElement.querySelector('code') || cp.parentElement;
    navigator.clipboard && navigator.clipboard.writeText(code.innerText);
    cp.textContent = '已复制'; setTimeout(() => (cp.textContent = '复制'), 1200);
  });
  article.querySelectorAll('a[href^="http"]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
})();
