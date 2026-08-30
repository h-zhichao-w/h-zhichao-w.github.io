---
author:
  - Hansen Wong
title: "关于 GRPO"
date: "2025-12-24"
tags:
  - RL
  - algorithm
  - LLM
series: ["RLVR 算法演进"]
series_order: 1
description: 关于 GRPO 的简单介绍
math: true
---
## 从 PPO 出发

在传统的 RLHF 流程中，我们通常使用 PPO (Proximal Policy Optimization) 算法，在这个范式下，通常需要加载四个模型：Actor, Critic, Reward, Reference以及同时更新Actor 和 Critc，这导致算法整体的计算开销非常之大，远远超过传统的 SFT 和 DPO 方法 (DPO 方法只需要加载 Actor 和 Reference)。

那么为什么 PPO 要加载这四个模型呢？下图提供了一直观的展示：(蓝色表示 frozen model, 黄色表示Trained model)

![PPO流程示意图](https://notes.sjtu.edu.cn/uploads/upload_7009606a088ff8badf148ace23645037.png)

$$
L_t^{CLIP}(\theta) = \hat{\mathbb{E}}_t \left[ \min(r_t(\theta) \hat{A}_t, \text{clip}(r_t(\theta), 1 - \epsilon, 1 + \epsilon) \hat{A}_t) \right]
$$

其中 $r_t(\theta) = \frac{\pi_\theta(a_t|s_t)}{\pi_{\theta_{old}}(a_t|s_t)}$ 是新旧策略的概率比。可以发现，优势函数 A 是基于 Reward 和 Reference 的 KL 散度 $r$ 以及 Critic 的 $v$，经过 GAE (Generalized Advantage Estimation) 计算得到的。也正因此，Critc 需要和 Actor 同时训练以消除过拟合的问题。

那有没有可能简化这个过程呢？

有的兄弟，有的。

## 然后我们来到了 GRPO

上面那个计算过程这么复杂，其实主要的就是因为优势太难估计了。也就是说，如果能找到一个更简单的估计优势的方法，那就能大大简化这个过程。

那我们回到优势的本质，它其实是描述一个动作到底有多好。俗话说不怕不识货，就怕货比货。一个输出的优势难估计，那我把它放到一组输出里面去对比，不就知道他有多好了吗？

假设对于一个 query，我一次性让模型输出一组 output $\{o_i | i=1, 2, ..., G\}$，每一个 $o_i$ 都可以算出一个 reward $r_i$，那么这个 $r_i$ 在这个组内的表现有多好就可以表达为：

$$
A_i = \frac{r_i - \text{mean}(r_1, r_2, ..., r_G)}{\text{std}(r_1, r_2, ..., r_G)}
$$

通过这种方式，算法只需要知道“哪个回答比这一组里的其他回答更好”，而不需要通过一个额外的庞大模型来预测“这个回答到底有多好”。

迈出了这一步，就已经把 PPO 简化一大半了！

![GRPO流程示意图](https://notes.sjtu.edu.cn/uploads/upload_9248bf3a41fb32b6a712af93cb05f851.png)

不难观察到，在 GRPO 的流程中，我们完全不需要 Critic ，现在只需要训练 Actor 就可以了！那么GRPO 的损失函数也就变成了：组内相对优势的策略梯度项 和 KL 散度约束项。

$$
J_{GRPO}(\theta) = \frac{1}{G} \sum_{i=1}^{G} \left[ \min \left( \frac{\pi_\theta(o_i|q)}{\pi_{\theta_{old}}(o_i|q)} A_i, \text{clip}\left(\frac{\pi_\theta(o_i|q)}{\pi_{\theta_{old}}(o_i|q)}, 1-\epsilon, 1+\epsilon\right) A_i \right) - \beta D_{KL}(\pi_\theta || \pi_{ref}) \right]
$$

需要指出，这里的 KL 散度和原来的 KL 散度有一些区别。在标准的 RLHF（如 PPO）中，KL 散度通常直接定义为：$$D_{KL}(P \parallel Q) = \sum P(x) \log \frac{P(x)}{Q(x)}$$但在 GRPO 的 Loss 函数中，为了便于在大规模并行训练中直接计算梯度并降低方差，DeepSeek 使用了如下形式的 KL 惩罚项：$$D_{KL}(\pi_\theta \parallel \pi_{ref}) = \frac{\pi_{ref}(o|q)}{\pi_\theta(o|q)} - \log \frac{\pi_{ref}(o|q)}{\pi_\theta(o|q)} - 1$$
这个公式实际上是 KL 散度的一种近似或替代形式（有时被称为“反向 KL”的一种变体估算器）。它的特点是：
1. 不需要对 $\pi_{ref}$ 采样，只需要在计算 $\pi_\theta$ 的概率时，同时计算 $\pi_{ref}$ 的概率。
2. 非负性：根据不等式 $x - \log x - 1 \ge 0$（当且仅当 $x=1$ 时等于 0），这个项永远大于等于 0，天然符合距离度量的特性。
3. 梯度更稳定：这种形式在策略偏离参考模型较远时，提供的梯度更为平滑，不容易出现数值爆炸。

## 来点代码

这里给出一个简单的 GRPO 的 Loss 函数的模块实现：

```python
import torch
import torch.nn as nn
import torch.nn.functional as F

class GRPOLoss(nn.Module):
    def __init__(self, beta=0.01, epsilon=0.2):
        super(GRPOLoss, self).__init__()
        self.beta = beta      # KL 惩罚系数
        self.epsilon = epsilon  # PPO 裁剪范围

    def compute_advantages(self, rewards):
        """
        计算组内相对优势 (Group Relative Advantages)
        rewards 形状: [batch_size, group_size]
        """
        mean = rewards.mean(dim=1, keepdim=True)
        std = rewards.std(dim=1, keepdim=True) + 1e-8
        advantages = (rewards - mean) / std
        return advantages.view(-1)  # 展平为 [batch_size * group_size]

    def compute_kl_divergence(self, log_probs, ref_log_probs):
        """
        计算 DeepSeek 特色的 KL 散度近似值
        公式: KL = exp(ref_log_probs - log_probs) - (ref_log_probs - log_probs) - 1
        """
        # 注意：这里计算的是针对当前策略 pi_theta 的 KL 惩罚
        # 注意：log_prob 代表取对数的概率分布，原始公式中需要的是概率比，因此在这里用 log_prob 的差值，对数相减后用 exp 函数还原成概率比
        ratio = torch.exp(ref_log_probs - log_probs)
        kl = ratio - (ref_log_probs - log_probs) - 1
        return kl

    def forward(self, logits, tokens, old_log_probs, ref_log_probs, rewards, attention_mask):
        """
        完整的 GRPO Loss 计算
        cur_log_probs: 当前输出的 log_probs [B*G, seq_len]
        old_log_probs: 采样时旧模型的 log_probs [B*G, seq_len]
        ref_log_probs: 参考模型的 log_probs [B*G, seq_len]
        rewards: 外部奖励得分 [B, G]
        attention_mask: 掩码 [B*G, seq_len]
        """
        # 1. 计算组内优势
        advantages = self.compute_advantages(rewards) # [B*G]
        
        # 2. 计算重要性采样比率 (Importance Sampling Ratio)
        # 只在序列维度计算 ratio，后面会根据 mask 平均
        ratio = torch.exp(cur_log_probs - old_log_probs)
        
        # 3. 计算 PPO 裁剪损失 (Surrogate Loss)
        surr1 = ratio * advantages.unsqueeze(-1)
        surr2 = torch.clamp(ratio, 1 - self.epsilon, 1 + self.epsilon) * advantages.unsqueeze(-1)
        policy_loss = -torch.min(surr1, surr2)
        
        # 5. 计算 KL 散度项
        kl_loss = self.compute_kl_divergence(per_token_logps, ref_log_probs)
        
        # 6. 结合两项并应用 mask
        total_loss = policy_loss + self.beta * kl_loss
        
        # 只计算 mask 为 1 的部分的平均值
        masked_loss = (total_loss * attention_mask).sum() / attention_mask.sum()
        
        return masked_loss
        
```

## 那么，古尔丹，代价是什么呢

GRPO 极大地节省了显存，但是 nothing comes for free

- **高度依赖组的大小**: GRPO 的核心假设是，通过组内样本的平均值可以有效替代 Critic 模型的 Baseline。但是，如果 $G$ 设置得太小，计算出的平均值和标准差极不稳定，导致 Advantage 估计方差巨大，训练难以收敛。
- **“组内平庸”陷阱**: 由于 GRPO 只关注相对好坏，如果某一次采样的 $G$ 个回答全部都很差，GRPO 依然会从中选出一个“相对不那么差”的给予正向激励，这可能导致模型在某些困难任务上学习到错误的模式，又或者在训练开始阶段因为没有输出好回答，导致永远在差回答里面打转，因为它仅仅是在“矮子里拔将军”，而不是朝着“绝对正确”的目标演化。相比之下，传统的 Critic 模型理论上能学习到该状态的绝对低价值。
- **对奖励函数的极高要求**: 在 PPO 中，即便 Reward 有一点噪声，Critic 模型（Value Network）作为一种神经网络，可以通过大量的样本学习起到一定的平滑和去噪作用。而 GRPO 直接使用 Reward 计算优势，也就是说如果 Reward 函数存在漏洞，模型会迅速利用这个漏洞，因为没有 Critic 来对这种不合理的奖励预测进行“二次校验”。


Reference
---
1. [DeepSeekMath](https://arxiv.org/pdf/2402.03300)
2. [DeepSeek-R1](https://arxiv.org/pdf/2501.12948)