const article = document.querySelector('#article');
const toc = document.querySelector('#toc');
const progress = document.querySelector('.reading-progress span');
const search = document.querySelector('#search');
const searchStatus = document.querySelector('#search-status');
const sidebarButton = document.querySelector('.sidebar-toggle');
const closeSidebar = document.querySelector('.close-sidebar');
const backdrop = document.querySelector('.sidebar-backdrop');
const themeButton = document.querySelector('.theme-button');

const headings = [...article.querySelectorAll('h1')].filter((heading) => !heading.textContent.includes('跳转目录'));
headings.forEach((heading, index) => {
  heading.id = `section-${index + 1}`;
  const item = document.createElement('a');
  item.href = `#${heading.id}`;
  item.className = 'toc-item';
  item.textContent = heading.textContent.trim().replace(/^\p{Extended_Pictographic}\s*/u, '');
  item.addEventListener('click', () => document.body.classList.remove('sidebar-open'));
  toc.append(item);
});

const words = article.textContent.trim().length;
document.querySelector('#reading-time').textContent = `约 ${Math.max(1, Math.ceil(words / 420))} 分钟`;

function updateReading() {
  const height = document.documentElement.scrollHeight - window.innerHeight;
  progress.style.width = `${height > 0 ? (window.scrollY / height) * 100 : 0}%`;
}
window.addEventListener('scroll', updateReading, { passive: true });
updateReading();

const observer = new IntersectionObserver((entries) => {
  const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
  if (!visible) return;
  document.querySelectorAll('.toc-item').forEach((item) => item.classList.toggle('active', item.hash === `#${visible.target.id}`));
}, { rootMargin: '-18% 0px -74% 0px', threshold: 0 });
headings.forEach((heading) => observer.observe(heading));

function clearMarks() {
  article.querySelectorAll('mark[data-search]').forEach((mark) => mark.replaceWith(document.createTextNode(mark.textContent)));
}

function highlight(query) {
  clearMarks();
  if (!query) { searchStatus.classList.remove('visible'); return; }
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  let matches = 0;
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      regex.lastIndex = 0;
      return node.parentElement.closest('script, style, mark') || !regex.test(node.nodeValue) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    regex.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    const text = node.nodeValue;
    let last = 0;
    text.replace(regex, (value, offset) => {
      fragment.append(document.createTextNode(text.slice(last, offset)));
      const mark = document.createElement('mark');
      mark.dataset.search = 'true';
      mark.textContent = value;
      fragment.append(mark);
      last = offset + value.length;
      matches += 1;
    });
    fragment.append(document.createTextNode(text.slice(last)));
    node.replaceWith(fragment);
  });
  searchStatus.textContent = matches ? `找到 ${matches} 处匹配` : '未找到匹配内容';
  searchStatus.classList.add('visible');
  const first = article.querySelector('mark[data-search]');
  if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
search.addEventListener('input', (event) => highlight(event.target.value.trim()));
window.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement !== search) { event.preventDefault(); search.focus(); }
  if (event.key === 'Escape') { search.value = ''; highlight(''); search.blur(); document.body.classList.remove('sidebar-open'); }
});

function toggleSidebar() { document.body.classList.toggle('sidebar-open'); }
sidebarButton.addEventListener('click', toggleSidebar);
closeSidebar.addEventListener('click', toggleSidebar);
backdrop.addEventListener('click', toggleSidebar);

const savedTheme = localStorage.getItem('interview-notes-theme');
if (savedTheme === 'night') document.documentElement.dataset.theme = 'night';
themeButton.addEventListener('click', () => {
  const night = document.documentElement.dataset.theme !== 'night';
  document.documentElement.dataset.theme = night ? 'night' : '';
  localStorage.setItem('interview-notes-theme', night ? 'night' : 'light');
});
