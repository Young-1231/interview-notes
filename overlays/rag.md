## 导读
RAG 面试基本围绕一条链路追问：解析 → Chunking → Embedding → 索引/检索（BM25 + 向量 + RRF）→ Rerank → 生成 → 评估。
- 先背：RAG 基本流程、Chunk 大小的取舍、混合检索与 RRF、Bi-Encoder vs Cross-Encoder、幻觉成因与对策、RAG vs 微调、评估指标（Recall@K / MRR / NDCG、Ragas 的 Faithfulness 等）。
- 最容易混的：召回率和精准率；粗排和精排；HNSW、IVF、PQ、DiskANN 各自的取舍；Ragas 和 RAGChecker 的评估粒度。

## 纠正: Embedding 维度怎么选型
原文说"维度越高，存储、计算、索引成本指数级上升"，实际是线性增长。存储是 向量数 × 维度 × 每维字节数，单次距离计算是 O(d)，维度翻倍，成本大约也翻倍。
维度不是越高越好，这个结论没错。但理由是边际收益递减、成本线性增加，不是"指数级"。另外，用 Matryoshka 方式训练的模型（如 OpenAI text-embedding-3 系列，可通过 dimensions 参数指定）可以把向量截短使用。

## 纠正: GraphRAG知识图谱的建立过程
原文说 Leiden 解决了 Louvain 的"分辨率限制"，这不对。分辨率限制是模块度（modularity）这个目标函数本身的问题，Leiden 用模块度做目标时同样存在（改用 CPM 等目标函数才能缓解）。
Leiden（Traag 等，2019）真正解决的是 Louvain 可能产出连接很差甚至内部不连通的社区。它靠 refinement 阶段保证每个社区内部连通，而且通常收敛更快。

## 纠正: 如何选择合适的Embedding模型
原文说 MTEB "覆盖 8 类任务、58 个数据集、112 种语言，是目前最全面的基准"，这是 2022 年原始 MTEB 论文的数据，已经过时。
2025 年的 MMTEB 把基准扩展到 500+ 个任务、250+ 种语言。现在的排行榜按不同 benchmark 分开展示（如 MTEB(eng, v2)、MTEB(cmn) / C-MTEB、MTEB(Multilingual)）。选中文模型时，看中文榜和自己的业务评测集即可。

## 补充: RAG系统最新的评价框架
Ragas 新版本的指标集合变了：Context Relevancy 在 0.1 版本被标记弃用，0.2 起移除，检索侧主要用 Context Precision 和 Context Recall。Answer Relevance 在 0.2 中叫 Response Relevancy。
无需标准答案就能算的是 Faithfulness 和 Response Relevancy。Context Recall 必须有 reference（标准答案）。

## 补充: Rerank模型和Embedding模型有什么区别
Cross-Encoder 是把 query 和 doc 拼接成一个序列送进 Transformer，两者通过 self-attention 做 token 级交互，模型里并没有单独的 cross-attention 层。
介于两者之间的是 ColBERT 这类 late interaction（多向量）模型：文档的 token 向量可以离线算好，查询时用 MaxSim 做细粒度匹配。bge-m3 的 multi-vector 输出就是这种思路。

## 补充: RAG如何做检索
BM25 相比 TF-IDF 的两个关键参数：k1 控制词频饱和（常用 1.2–2.0），词频再高，得分也会趋于上限；b 控制文档长度归一化（常用 0.75，b=0 表示不做长度归一化）。
RRF 只看名次，不看分数，所以各路召回的分数不需要归一化。加权分数融合则必须先做 min-max 等归一化。

## 补充: 为什么选择用Milvus
Milvus 2.4 起支持一个 collection 里放多个向量字段，并做多路 hybrid search，内置 RRFRanker / WeightedRanker 融合。Milvus 2.5 起内置 BM25 全文检索（以稀疏向量形式存储）。
所以"关键词 + 向量"的混合检索现在可以只在 Milvus 内完成，不一定要再搭一套 ES。

## 补充: FAISS向量检索的原理
FAISS 只原生支持 L2 和内积（METRIC_INNER_PRODUCT）两种度量。要用余弦相似度，需要先把向量 L2 归一化，再用内积。
常问的调参项：IVF 的 nlist（簇数）和 nprobe（查询时搜几个簇，越大召回越高、越慢）；HNSW 的 M（每个节点的邻居数）、efConstruction 和 efSearch。

## 自测
### RAG 的核心流程分哪几步？
离线：解析 → 切块 → Embedding → 写入向量库并建索引。在线：Query 改写 → 多路召回 → 融合 → Rerank → 拼进 Prompt → LLM 生成，最好带上引用来源。
### Chunk 太大和太小分别有什么问题？
太大：语义被稀释，向量不准，噪声多、耗 token。太小：信息不完整、语义断裂，要召回很多块拼接。常见做法是按结构切分，加 overlap，再补上标题路径等元数据。
### 为什么生产环境推荐混合检索？
BM25 擅长精确匹配编号、错误码、专有名词，向量检索擅长同义改写和语义相近的表达。两者互补，能同时提高召回的覆盖面和稳定性。
### RRF 怎么算？k 常取多少？
score(d) = Σ 1/(k + rank_i(d))，只用名次，不用原始分数。k 常取 60。
### Bi-Encoder 和 Cross-Encoder 的区别？
Bi-Encoder 把 query 和 doc 分别编码，doc 向量可以离线算好，速度快，用于召回。Cross-Encoder 把两者拼接后联合编码，精度高但每一对都要在线计算，只能用于对少量候选精排。
### 为什么不直接对全库做 Rerank？
Cross-Encoder 必须等 query 到了才能逐对计算，对全库算延迟不可接受。所以先用向量/BM25 召回 Top 50 左右，再精排。两阶段的上限受第一阶段召回率限制。
### HNSW、IVF、PQ、DiskANN 各自的特点？
HNSW 是多层图，查询快、召回高，但占内存。IVF 先聚类，只搜最近的几个簇。PQ 做向量压缩，省内存但损失精度。DiskANN 把图和原始向量放在 SSD 上，适合内存放不下的超大规模数据。
### 召回率和精准率分别是什么？
召回率 = 检出的相关文档 / 全部相关文档。精准率 = 检出的相关文档 / 检出的全部文档。Top K 调大，召回率上升、精准率下降。
### MRR 和 NDCG 有什么区别？
MRR 只看第一个相关结果的名次倒数，再对所有 query 求平均。NDCG 考虑多个相关结果的分级相关性和位置折扣，并用理想排序做归一化。
### RAG 用了检索为什么还会有幻觉？
可能是没召回到、排序靠后被截断、知识库缺失或内容冲突、上下文噪声太多，或者模型忽视上下文而用自己的参数知识。对策：混合检索 + Rerank + 相似度阈值、Prompt 约束、引用溯源、答案校验。
### RAG 和微调怎么选？
缺知识、知识更新频繁、需要可溯源，选 RAG。要固定输出格式、风格、任务能力，选微调。两种需求都有就组合使用。
### HyDE 是什么？
先让 LLM 针对问题生成一个假设答案，再用这个答案的向量去检索，缩小"问题"和"文档"之间的语义差距。
### 多轮对话 RAG 的关键是什么？
检索前做 Query 改写：结合历史对话做指代消解和省略补全，得到一个能独立理解的查询再去检索。
### GraphRAG 的 local 和 global search 分别适合什么问题？
Local 从具体实体出发，沿邻居和关系找答案，适合问具体实体的细节。Global 基于社区摘要做 map-reduce，适合"整体趋势、主题有哪些"这类全局总结问题。
### GraphRAG 的主要劣势是什么？
建图要大量调用 LLM 做抽取和社区摘要，成本高；增量更新难；链路长，难调优。LightRAG 和 LazyGraphRAG 分别针对更新和前置成本做了改进。
### Ragas 的 Faithfulness 怎么算？
把答案拆成若干 claim，统计能被检索上下文支持的 claim 占比。不需要标准答案。
### RAGChecker 相比 Ragas 好在哪？
做 claim 级的细粒度对比，能分别给出检索指标（claim recall、context precision）和生成指标（幻觉、噪声敏感度、上下文利用率），便于定位问题出在哪个模块。代价是评估成本更高。
### 知识库新增或修改文档怎样快速生效？
增量入库：异步解析、切块、向量化后写入。修改时按文档 ID 让旧 chunk 失效或删除，再写入新版本，同时用版本号或状态字段过滤旧内容，并刷新缓存。
