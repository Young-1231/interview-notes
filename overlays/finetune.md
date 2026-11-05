## 导读
- 高频主线：预训练 → SFT → RLHF(PPO) / DPO / GRPO 的关系，LoRA/QLoRA 原理与显存账，训练/推理显存估算。
- 先背：LoRA 公式与 alpha/r 缩放、训练显存四大块、KV Cache 公式、PPO 四个模型、DPO 与 PPO 区别、GRPO 组内归一化优势。
- 易混：PPO 的「优势」来自 Critic(GAE)，「新旧策略比」用于 clip，两者不是一回事；DPO 是离线偏好优化，不是在线 RL；GRPO 出自 DeepSeekMath，不是 V3 首创。

## 纠正: GRPO
原文说「GRPO 是 DeepSeekV3 提出的」，实际 GRPO 最早在 DeepSeekMath(2024.02)论文中提出，用于数学推理的 RL。
DeepSeek-V3 后训练和 DeepSeek-R1 / R1-Zero 沿用了 GRPO，R1 让它广为人知。

## 纠正: 对比三大经典的大模型强化学习算法
原文说 PPO「把当前结果和旧策略下的结果进行比较，计算优势」，实际 PPO 的优势由 Reward 与 Critic 估计的价值算出(通常用 GAE)，与旧策略无关。
和旧策略比较的是概率比 r = π_new/π_old，它和 clip 一起限制单步更新幅度。所以「PPO 用 Critic 估优势，GRPO 用组内均值/标准差估优势」才是两者的核心区别。

## 纠正: DAPO、GSPO发展流程
原文把 DAPO 写成「Direct Alignment from Preference Optimization」，并说需要 Actor+Ref 两个模型，实际 DAPO 是 Decoupled Clip and Dynamic sAmpling Policy Optimization(字节 Seed，2025)，是 GRPO 的改进版在线 RL，不是偏好对齐方法。
它的要点：Clip-Higher(上、下裁剪界解耦，调高上界，让低概率 token 能涨上来，防止熵塌缩)、动态采样(过滤组内全对或全错、优势为 0 的样本)、token 级 loss 平均、超长回答的奖励整形。DAPO 去掉了 KL 项，所以不需要 Reference 模型。

## 纠正: SFT的灾难性遗忘如何解决
原文说 LoRA 冻结底座后「基座的通用能力得以完整保留」，实际只要挂上或合并了 Adapter，模型的输出分布就变了，同样会有遗忘，只是通常比全量微调轻。
只有卸掉 Adapter 才能回到原模型。所以 LoRA 是「降低遗忘」，不是「消除遗忘」，仍需要混合通用数据、控制学习率和 epoch。

## 补充: 什么是LoRA
标准写法：h = W0·x + (α/r)·B·A·x，其中 B∈R^{d×r}，A∈R^{r×k}，r ≪ min(d,k)。
初始化时 A 用随机高斯，B 置 0，所以训练开始时 ΔW = 0，模型和原模型完全一致。
单层可训练参数从 d×k 降到 r×(d+k)。推理时合并 W = W0 + (α/r)·BA，没有额外延迟。

## 补充: LoRA一般插在哪些层
原始论文只在 q、v 上做了实验，现在常用做法(QLoRA 论文和多数框架默认推荐)是挂到所有线性层(q/k/v/o + gate/up/down)，效果通常更好。
rank 常取 8–64，alpha 常取 rank 或 2×rank。改 rank 时 alpha/r 也跟着变，所以调参时要一起看。

## 补充: 大模型训练为什么这么吃显存
常用估算：混合精度 + Adam 全量训练，每个参数约 16 字节(FP16/BF16 权重 2 + 梯度 2 + FP32 主权重 4 + Adam 一阶 4 + 二阶 4)，激活值另算。
例如 7B 全量微调约 7×16 ≈ 112GB(不含激活)，所以要用 ZeRO / FSDP 切分，或者改用 LoRA。

## 补充: 推理阶段的显存消耗如何计算
原公式 2×b×s×l×h×bytes 只适用于 MHA(LLaMA-1/2 7B 就是 MHA，所以 0.5MB/token 的结果没错)。
GQA/MQA 模型要把 h 换成 n_kv_heads×head_dim。例如 LLaMA-3-8B 有 8 个 KV head(共 32 个 head)，KV Cache 只有同尺寸 MHA 的 1/4，约 128KB/token。

## 补充: QLoRA和LoRA有什么区别
QLoRA 的基座以 NF4 存储，前向/反向时按块反量化成 BF16 计算(compute dtype)，梯度只流向 LoRA 参数，LoRA 参数本身保持 BF16。
所以 QLoRA 省的是显存，训练速度通常比 LoRA 慢一些，因为多了反量化开销。

## 补充: DPO是什么，相比PPO
DPO 损失：L = -log σ( β·[log πθ(yw|x)/πref(yw|x) − log πθ(yl|x)/πref(yl|x)] )。
β 控制偏离参考模型的程度，β 越大约束越强。它的隐式奖励就是 β·log(πθ/πref)，这也解释了为什么只优化正负样本的「差」，正样本自身概率可能一起下降。

## 自测
### 预训练、SFT、RLHF 各解决什么问题？
预训练靠 next-token 预测学语言和知识；SFT 用指令数据学会听指令、按格式回答；RLHF/DPO 用偏好信号让输出更符合人类偏好。
### SFT 的 loss 和预训练有什么不同？
损失函数一样，都是交叉熵 next-token。SFT 通常只对回答部分算 loss，prompt 部分做 loss mask。
### LoRA 的前向公式和初始化？
h = W0x + (α/r)BAx。A 随机初始化，B 初始化为 0，保证一开始 ΔW = 0。
### LoRA 为什么推理不增加延迟？
训练后可以把 (α/r)BA 加回 W0 合并成一个矩阵，结构和原模型完全一样。
### LoRA 为什么省显存？
被冻结的参数不需要梯度和优化器状态。省的是这两块，基座权重仍然要全部加载。
### QLoRA 在 LoRA 基础上多了哪三项？
NF4 4-bit 量化基座、双重量化(把量化常数再量化)、分页优化器。
### 混合精度 Adam 全量训练每个参数约占多少显存？
约 16 字节：权重 2、梯度 2、FP32 主权重 4、Adam 两个动量各 4，激活另算。
### 7B 模型 FP16 推理的权重显存？
约 14GB(7B×2 字节)，INT8 约 7GB，INT4 约 3.5GB。
### KV Cache 显存公式？
2 × batch × seq × layers × n_kv_heads × head_dim × bytes。MHA 时 n_kv_heads×head_dim = hidden。
### FP16 和 BF16 的位数分配？
FP16 是 1 符号 + 5 指数 + 10 尾数，最大约 65504；BF16 是 1 + 8 + 7，范围与 FP32 相同。BF16 不容易溢出，一般不需要 loss scaling。
### Gradient Checkpointing 用什么换什么？
用重算换显存：前向只保存部分激活，反向时再重新计算。
### RLHF-PPO 有哪四个模型？哪些在训练？
Actor、Critic、Reward、Reference。只训练 Actor 和 Critic，Reward 和 Reference 冻结。
### PPO 中 KL 约束的作用？
防止 Actor 偏离 SFT/Reference 太远，避免 reward hacking 和语言能力退化。
### DPO 相比 PPO 省掉了什么？
不需要训练单独的 Reward Model，也不需要 Critic 和在线采样，只用 Actor + Reference 在偏好对上做监督式优化。
### GRPO 如何计算优势？
同一 prompt 采样一组回答并打分，优势 = (r − 组均值)/组标准差。不需要 Critic。
### GRPO 出自哪篇工作？
DeepSeekMath(2024)，之后 DeepSeek-V3 和 R1 都用了它。
### DPO 训练中正样本概率也下降，为什么？
DPO 只优化 chosen 和 rejected 的对数概率比之差，两者一起下降而差值变大，loss 仍然会下降。
### DeepSeek-R1 为什么要冷启动？
R1-Zero 纯 RL 的输出可读性差、中英混杂。先用少量高质量长 CoT 数据做 SFT，给 RL 一个更好的起点。
### 知识频繁更新时选 RAG 还是微调？
选 RAG。微调更适合固定行为模式：格式、话术、工具调用。
