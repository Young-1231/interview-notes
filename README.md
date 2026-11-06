# 八股笔记 · Java 后端 + AI Agent

静态 GitHub Pages 阅读站。每个章节一页(`jvm.html`、`mysql.html`、`real.html` …),章节内按子分组平铺题目和答案。

页面工具:只看高频、自测模式(先藏答案)、记住阅读位置、全站题目搜索(`/`)、`j`/`k` 上下题。状态存在浏览器 localStorage。

## 目录

- `content/*.md` 统一稿,站点唯一的内容来源。格式:
  ```markdown
  ## 子分组
  ### 题目 | 高频 | 工商银行、美团
  答案 markdown
  ```
  大章节拆成 `<id>-1.md`、`<id>-2.md` …,构建时按序拼接。
- `scripts/site.cjs` 站点结构:大块 → 章节 → 由哪些 content 文件组成
- `images/` 答案里引用的图片
- `sources/` 整理统一稿时用到的原始资料(PDF 由 `scripts/pdf/convert.sh` 转换);`scripts/legacy/` 是早期直接从资料生成页面的脚本,仅作参考

## 专题页:Agent 后端工程

独立页面 `agent-backend.html`,与八股站内容互不依赖(只共用配色)。

- `guide/agent-backend/NN-*.md` 每章一个文件,`## N. 标题 {必学|按需|进阶}`,章内 `###` 节;正文里 `<!-- svg:arch -->` 插入 `guide/diagrams/arch.svg`
- `node scripts/check-guide.cjs guide/agent-backend/*.md` 校验格式,`node scripts/build-guide.cjs` 生成页面

## 构建与预览

```sh
node scripts/check-content.cjs content/*.md   # 校验格式与用语
node scripts/build.cjs                        # 生成每个章节的 html 和 data/nav.json
python3 -m http.server 4173
```
