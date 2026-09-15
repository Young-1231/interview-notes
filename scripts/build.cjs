const fs = require('fs');
const path = require('path');
const MarkdownIt = require('../assets/markdown-it.js');

const root = path.resolve(__dirname, '..');
const template = fs.readFileSync(path.join(root, 'template.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'content.md'), 'utf8')
  .replace(/\n#\s*\n/g, '\n')
  .replace(/^# (add_conditional_edges绑定路由函数|MCP Server 侧（用Python SDK）|触发辅助（可选）|输入参数（JSON Schema）|执行器|权限|输出（可选）)$/gm, '#### $1');
const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
const content = md.render(source);

fs.writeFileSync(path.join(root, 'index.html'), template.replace('<!-- CONTENT -->', content));
