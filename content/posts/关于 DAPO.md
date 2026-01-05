---
author:
  - Hansen Wong
date: 2025-12-26
tags:
  - algorithm
  - LLM
  - RL
math: true
description: 关于 DAPO 的简单介绍
title: 关于 DAPO
---

你这实验结果怎么复现不出来啊
---

在之前的文章中，我们简单讲了一下 DeepSeek 的 [GRPO](https://h-zhichao-w.github.io/posts/%E5%85%B3%E4%BA%8E-grpo/)，它通过“去 Critic”和“组内博弈”极大地降低了强化学习的门槛，引来了非常多的关注。但是在复现 DeepSeek-R1 时，有些人就发现朴素的 GRPO（Naive GRPO）存在一些“小问题”，导致其在 AIME 上的得分只能停留在 30 分左右，远低于 DeepSeek 的 47 分——
1. **熵坍塌**（Entropy Collapse）：在训练初期，模型的 policy entropy 迅速下降，生成的回答趋同，如下图中的浅蓝色曲线。这意味着模型放弃了“探索”（Exploration），只顾着“利用”（Exploitation）。研究人员认为（后来也证明了）这是因为 PPO/GRPO 的 clip 机制是对称的。对于低概率的 exploration tokens,，它们很容易突破 $1 + \epsilon$ 的天花板，导致稍微有点苗头的创新想法被 Loss 函数截断了。

![](https://notes.sjtu.edu.cn/uploads/upload_f30f859e8d7c4ac1ddf9f77e5da55b8e.png "图1")

我们不妨假设有两种动作的概率分别是0.1和0.9，假设 $\epsilon=0.2$，也就是说 clip 的上界是原概率的1.2倍，对应到刚刚的动作中就分别是0.12和1.08。但是，1.08 > 1！一个 well-developed 行为，或者说是 exploitation tokens 根本不会受到裁剪的制约。相反地，一个 exploration token 因为它基础概率低，所以哪怕只上涨一点点就被裁剪掉了。

2. **梯度消失与样本效率低**：随着模型变强，很多 Prompt 对应的生成组（Group）里，所有回答可能都是正确的（Accuracy=1）（见下图）。然而根据 GRPO 的优势估计方法，如果一组回答全对（Reward 一样），归一化后的 Advantage 全是 0 。这导致整个 Batch 中有效梯度急剧减少，训练效率大打折扣。

![](https://notes.sjtu.edu.cn/uploads/upload_8708bc953872d0705a50dc156ace38e4.png "图2")


3. **奖励噪声** (Reward Noise)：为了防止显存爆炸，通常会截断过长的 CoT。但如果只是简单地给截断样本一个负分，会误伤那些“思路正确但没写完”的好样本，给模型带来错误的信号。

Up!
---

有了上面的分析，我们很容易想到，可以把裁剪的上下界范围解耦，也就是 **Clip-Higher** 策略。通过提升裁剪上界，给那些低概率的“潜力股”更多的上涨空间，允许它们在一次更新中获得更大的概率提升，从而维持策略的熵，同时保持下界不变，避免过度把策略的概率压缩到0。从图1及下图可以发现，应用了 Clip-Higher 后（紫色曲线）对比没应用（浅蓝色曲线）在训练效果和 policy entropy 的表现上都有显著提升。

![](https://notes.sjtu.edu.cn/uploads/upload_2430350b2e965ec4499a50b1e50533a8.png)

More~
---

而为了解决“全对样本导致梯度为 0”的问题，DAPO 引入了 Dynamic Sampling，也就是在采样阶段，直接丢弃那些 Accuracy 全为 0 或全为 1 的 Prompt（因为它们不提供梯度信息），并不断补充新样本，直到填满有效的 Batch Size。

而且，这种策略并不一定会影响训练效率，因为如果强化学习系统是同步的（synchronized）且生成阶段未流水线化），生成时间通常由长尾样本（long-tail samples）的生成所主导。此外，通过动态采样，实验能够更快地达到相同性能，如下图所示。

![](https://notes.sjtu.edu.cn/uploads/upload_b51be4c3a1531e77f0c14697e9ca5ea7.png)

平衡
---

原始的 GRPO 算法采用样本级的损失计算方式，该方式首先在每个样本内对损失进行 token 级别的平均，然后再在样本之间进行损失汇总。在这种方法中，每个样本在最终的损失计算中被赋予相同的权重。然而，在长链推理（long-CoT）的强化学习场景中，这种损失缩减方法会引入一些挑战。

由于所有样本在损失计算中被赋予相同的权重，较长响应中的 token（包含更多 token）可能对整体损失的贡献比例相对较低，这可能导致对于高质量的长样本，模型更难在其中学习与推理相关的模式。此外，过长的样本往往包含低质量的模式，如无意义的乱码和重复的词语。因此，样本级的损失计算由于无法有效惩罚长样本中的这些不良模式，导致熵值和响应长度出现不健康的增长，下图中浅蓝色曲线所示。

![](https://notes.sjtu.edu.cn/uploads/upload_c1834f0e58b2267b99518b993c29da7a.png)

所以在 DAPO 中，采用了一种 token 级的策略梯度损失（Token-level Policy Gradient Loss）：

<div>
$$
\begin{aligned}
\mathcal{J}_{\text{DAPO}}(\theta)=& \quad\mathbb{E}_{(q,a)\sim\mathcal{D},\{o_{i}\}_{i=1}^{G}\sim\pi_{ \theta_{\text{old}}}(\cdot|q)} \\
&\quad\Bigg[\frac{1}{\sum_{i=1}^{G}|o_{i}|}{\sum_{i=1}^{G}\sum_{t=1}^{|o_{i}|}\min\Big(r_{i,t}(\theta)\hat{A}_{i,t},\ \text{clip}\Big(r_{i,t}(\theta),1-\varepsilon_{\text{low}},1+ \varepsilon_{\text{high}}\Big)\hat{A}_{i,t}\Big)}\Bigg], \\
\text{s.t.}&\quad 0 < \Big|\{o_{i}\mid\texttt{is\_equivalent}(a,o_{i})\}\Big| < G.
\end{aligned}
$$
</div>

在这种设置中，较长的序列相比较短的序列对整体梯度更新具有更大的影响。此外，从单个 token 的角度来看，如果某种生成模式能够导致奖励增加或减少，那么不管它出现在长响应还是短响应中，都将被同等程度地 prompted 或 suppressed。

躲猫猫
---

最后，针对“长样本截断”问题，DAPO 采用了一种超长奖励塑造（Overlong Reward Shaping）的策略，不直接“一刀切”给负分，而是使用 Soft Punishment（软惩罚）或者 Overlong Filtering（超长过滤）直接 Mask 掉这些样本的 Loss，减少对训练的干扰。

Soft Punishment的公式长这样：

$$
R_{\mathrm{length}}(y) = \begin{cases} 0, & |y| \leq L_{\mathrm{max}} - L_{\mathrm{cache}} \\\\ \frac{(L_{\mathrm{max}} - L_{\mathrm{cache}}) - |y|}{L_{\mathrm{cache}}}, & L_{\mathrm{max}} - L_{\mathrm{cache}} < |y| \leq L_{\mathrm{max}} \\\\ -1, & L_{\mathrm{max}} < |y| \end{cases}
$$

对比发现，这种策略极大地稳定了训了并提升了效果。

![](https://notes.sjtu.edu.cn/uploads/upload_6a202480a57082da5e34d0aad259d6e1.png)

巅峰对决
---

最终实验发现，使用 DAPO 训练 Qwen2.5-32B 在 AIME 2024 数据集上达到了 50 分，超过了此前的 SOTA （DeepSeek-R1-Zero-Qwen-32B，47 分）的同时仅用了 50% 的训练步数。

![](https://notes.sjtu.edu.cn/uploads/upload_8791ff227a137298c6fd45cbb3edf0c4.png)

Reference
---
[DAPO: An Open-Source LLM Reinforcement Learning System at Scale](https://arxiv.org/pdf/2503.14476)
