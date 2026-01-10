---
author:
  - Hansen Wong
date: 2026-01-09
title: 关于 SPO
description: 另一种对 GRPO 的改进方法的介绍
math: true
tags:
  - algorithm
  - LLM
  - RL
---

前言
---

关于 [GRPO](https://h-zhichao-w.github.io/posts/%E5%85%B3%E4%BA%8E-grpo/) 及其[弊端](https://h-zhichao-w.github.io/posts/%E5%85%B3%E4%BA%8E-dapo/#%E4%BD%A0%E8%BF%99%E5%AE%9E%E9%AA%8C%E7%BB%93%E6%9E%9C%E6%80%8E%E4%B9%88%E5%A4%8D%E7%8E%B0%E4%B8%8D%E5%87%BA%E6%9D%A5%E5%95%8A)我们之前已经讲过很多，这次我们来介绍另一种对 GRPO 提出改进的方法。 

对于 GRPO 可能带来的退化组（奖励全部相同的组）问题，DAPO 采取的改进策略是 Dynamic Sampling，即在采样阶段，直接丢弃那些退化的组，但这种做法本质上是一种**拒绝采样（Rejection Sampling）**。虽然它保证了梯度不为零，但代价高昂：

- **无限等待风险**：对于极难题目，可能采样 100 次也出不了一个正确答案。动态采样会导致训练循环陷入不可控的等待，破坏流水线并行。

- **分布偏移**：人为地筛选样本会扭曲模型对真实成功率的感知，引入难以量化的偏差。

- **工程复杂度**：需要在训练循环中嵌入复杂的判断逻辑，使得系统难以维护和扩展。

如果我们回看这个问题的本质，不难发现这个问题是自 GRPO 将优势估计退化为组平均表现带来的，而 DAPO 缝缝补补，试图给 GRPO 打上补丁，修补这个有缺陷的组平均计算方法。

因此如果要彻底消除这个问题，还是得从根源入手。

重构价值估计的数学基础
---

消除这个问题的核心就是 "Group-free"，即摒弃了同一 Prompt 多次采样的约束，将每个 (Prompt, Response) 数据对视为独立的训练单元，这也就是我们今天要介绍的 **SPO (Single-stream Policy Optimization)** 的基本思想。

为了实现这一目标，SPO 必须解决一个核心难题——如果没有组内样本做参考，如何获得低方差的优势估计？SPO 给出的答案是三个协同工作的组件：

### KL 自适应价值追踪器（KL-Adaptive Value Tracker）

> 记忆是最好的 Critic

在 RLVR 场景中，奖励通常是二元的（0 或 1）。SPO 利用这一特性，采用 Beta 分布 来建模每个 Prompt 的成功率 $V(x)$。Beta 分布是二项分布的共轭先验，非常适合处理这种“成功/失败”的统计。对于每个 Prompt $x$，SPO 维护两个统计量：$\alpha(x)$——加权累计成功次数（Effective Successes），和 $\beta(x)$——加权累计失败次数（Effective Failures）。当前的价值估计 $\hat{v}(x)$ 即为 Beta 分布的后验均值：

$$\hat{v}(x) = \frac{\alpha(x)}{\alpha(x) + \beta(x)}$$

随着训练进行，策略 $\pi_\theta$ 在不断进化，旧的成功率数据不再代表当前能力。因此，追踪器必须具备“遗忘”旧数据的能力。SPO 引入了一个遗忘因子 $\rho(x)$，每次观察到新奖励 $r \in \{0, 1\}$ 后，更新规则如下：

$$\alpha_{new}(x) = \rho(x) \cdot \alpha_{old}(x) + r$$

$$\beta_{new}(x) = \rho(x) \cdot \beta_{old}(x) + (1-r)$$

这在数学上等价于对价值估计进行**指数移动平均（EMA）**。但与普通 EMA 不同，SPO 的 $\rho(x)$ 是**KL 自适应**的。因为如果策略变化剧烈，价值追踪器就需要更快速遗忘旧历史，否则基线会有偏差（Bias）。而如果策略很稳定，则应该保留更多历史，以利用大样本量降低方差（Variance）。SPO 利用 KL 散度（KL Divergence） 来动态调整 $\rho(x)$：

$$ \rho(x) = 2^{-D_{KL}(\pi_{old} || \pi_{new}) / D_{half}} $$

其中 $D_{KL}$ 衡量了策略在当前 Prompt 上的分布变化，$D_{half}$ 是一个控制半衰期的超参数。当 $D_{KL}$ 很大（策略剧变），$\rho(x)$ 迅速减小，追踪器快速“重置”。当 $D_{KL}$ 很小（策略收敛），$\rho(x)$ 接近 1，追踪器退化为长期平均，提供极其稳定的基线。

### 全局优势归一化

> 大数定律的胜利

有了基线 $\hat{v}(x)$，就能得到原始优势 $A_{raw} = r - \hat{v}(x)$。接下来的问题是如何归一化。GRPO 采用组内归一化，由于组大小 $G$ 通常很小（如 8 或 16），组内方差 $\sigma_G$ 是一个噪声极大的估计量。用一个噪声很大的数去作分母，会严重放大梯度的方差。SPO 转向了**全局视角**。它收集整个 Training Batch（通常包含数千个样本）的优势，计算全局均值 $\mu_{\mathcal{B}}$ 和全局标准差 $\sigma_{\mathcal{B}}$：

$$\tilde{A}(x, y) = \frac{A_{raw}(x, y) - \mu_{\mathcal{B}}}{\sigma_{\mathcal{B}}}$$

由于 Batch Size 远大于 Group Size，$\sigma_{\mathcal{B}}$ 是一个极其稳定的统计量。这种全局归一化不仅平滑了梯度，还确保了不同难度的样本在更新幅度上具有可比性，防止了某些离群样本主导梯度方向，类似于 Batch Normalization 在监督学习中的作用。

### 优先级采样

> 内建的课程学习机制

SPO 的价值追踪器不仅用于计算优势，还提供了一个极其重要的信息——**题目难度**。$\hat{v}(x) \approx 0$ 代表训练数据极难，几乎全错。$\hat{v}(x) \approx 1$ 代表训练数据极易，几乎全对。$\hat{v}(x) \approx 0.5$ 则说明训练数据处于当前模型能力边界，不确定性最大。根据信息论，熵（不确定性）最大的样本包含最多的学习信号。SPO 利用这一点构建了**优先级采样（Prioritized Sampling）** 机制。采样概率 $w(x)$ 被设计为与伯努利分布的标准差成正比：

$$w(x) \propto \sqrt{\hat{v}(x)(1-\hat{v}(x))} + \epsilon$$

这意味着 SPO 会自动将算力集中在模型“跳一跳够得着”的题目上，自动实现**课程学习（Curriculum Learning）**。而 $\epsilon$ 项（默认为 0.05）保证了基本的探索性，防止对困难问题的永久性遗忘（Curriculum Collapse）。相比之下，GRPO 只能盲目地均匀采样。

实验结果
---

实验结果显示，SPO 在所有测试基准上均优于 GRPO，特别是在那些最具挑战性的数据集上，SPO 展现出了惊人的统治力。此外， GRPO 受限于同步屏障，必须等待组内最慢的样本。随着组大小增加，遭遇极端长尾（Straggler）的概率剧增。而 SPO 则是完全异步处理。实验发现，在长尾分布下，SPO 的训练吞吐量（Throughput）达到了 GRPO 的 4.35 倍。

SPO 用最朴素的概率统计工具（Beta 分布、KL 散度、大数定律），构建了一个比复杂工程堆叠更强大、更稳健、更高效的系统。不过，SPO 目前主要展示了在二元奖励（RLVR）下的实践，尽管其框架完全兼容连续奖励，但在 RLHF pipeline 上是否依然有这么惊艳的效果尚未可知。

Reference
---
1. [Single-stream Policy Optimization](https://arxiv.org/pdf/2509.13232)