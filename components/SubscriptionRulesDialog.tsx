"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface SubscriptionRulesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isDomestic: boolean;
}

const domesticRules = `# 订阅规则（国内版）

**适用版本**：AI Generator Platform 国内版

**生效日期**：2025年3月13日

---

## 一、订阅套餐

| 套餐 | 月付价格 | 年付价格(月均) | 每日AI调用 | 月文档生成 | 月图片生成 | 月音频生成 | 月视频生成 |
|:---:|:-------:|:------------:|:-------------:|:--------:|:--------:|:--------:|:--------:|
| Free | 免费 | - | 10次 | 10次 | 10次 | 5次 | 5次 |
| Basic(基础版) | ￥29.90 | ￥20.90 | 50次 | 50次 | 50次 | 20次 | 20次 |
| Pro(专业版) | ￥99.90 | ￥69.90 | 200次 | 200次 | 200次 | 100次 | 100次 |
| Enterprise(企业版) | ￥199.90 | ￥139.90 | 2000次 | 2000次 | 2000次 | 500次 | 500次 |

> **说明**：通用AI模型（国内版使用阿里通义千问 qwen-turbo）对所有用户无限制使用，不消耗每日调用次数。

---

## 二、订阅计算规则

### 2.1 同级续费（续订相同套餐）

当您续订相同套餐时，系统会自动顺延有效期：

- **月付续费**：在当前到期日基础上延长 1 个自然月
- **年付续费**：在当前到期日基础上延长 12 个自然月

### 2.2 升级订阅（从低级升至高级）

1. **计算剩余价值**：系统会计算您当前套餐的剩余天数，并按日折算剩余价值
2. **价值折算**：剩余价值会自动折算为新套餐的使用天数
3. **新到期日计算**：新套餐到期日 = 今天 + 折算天数 + 新购买周期天数
4. **生效时间**：升级立即生效

### 2.3 降级订阅（从高级降至低级）

1. **延迟生效**：降级不会立即生效，而是在当前套餐到期后次日生效
2. **继续享受**：在当前套餐到期前，您仍可继续享受高级套餐的全部权益

---

## 三、额度刷新机制

### 3.1 每日AI调用次数

- **刷新时间**：每日北京时间 00:00 自动刷新
- **刷新规则**：每日已用次数重置为 0

### 3.2 月度生成配额（文档/图片/音频/视频）

- **刷新时间**：按您的专属账单日刷新（即首次订阅的日期）
- **刷新规则**：月度配额重置为当前套餐的额度上限

---

## 四、加油包（额外额度）

| 档位 | 价格 | 文档额度 | 图片额度 | 音频额度 | 视频额度 | 有效期 |
|:---:|:---:|:------:|:------:|:------:|:------:|:-----:|
| Starter | ￥9.9 | 30次 | 30次 | 10次 | 10次 | 永久 |
| Standard | ￥29.9 | 100次 | 100次 | 30次 | 30次 | 永久 |
| Premium | ￥69.9 | 300次 | 300次 | 100次 | 100次 | 永久 |

**扣费策略**：优先消耗月度订阅额度，月度额度耗尽后才扣除加油包额度。

---

## 五、退款政策

- 订阅服务一经开通，不支持退款
- 加油包属于数字化虚拟商品，一经售出不支持退款

---

## 六、联系我们

如有疑问，请联系：support@aigenerator.com`;

const internationalRules = `# Subscription Terms (Global Edition)

**Applicable Edition**: AI Generator Platform Global Edition

**Effective Date**: March 13, 2025

---

## 1. Subscription Plans

| Plan | Monthly Price | Annual Price (per month) | Daily AI Calls | Monthly Documents | Monthly Images | Monthly Audio | Monthly Video |
|:---:|:-------------:|:------------------------:|:--------------:|:----------------:|:--------------:|:-------------:|:-------------:|
| Free | Free | - | 10 | 10 | 10 | 5 | 5 |
| Basic | $9.98 | $6.99 | 50 | 50 | 50 | 20 | 20 |
| Pro | $39.98 | $27.99 | 200 | 200 | 200 | 100 | 100 |
| Enterprise | $99.98 | $69.99 | 2000 | 2000 | 2000 | 500 | 500 |

> **Note**: The General AI Model (international edition uses Mistral AI) is unlimited for all users.

---

## 2. Subscription Calculation Rules

### 2.1 Same-tier Renewal

When you renew the same subscription plan, the system automatically extends your expiration date:

- **Monthly Renewal**: Extends by 1 calendar month
- **Annual Renewal**: Extends by 12 calendar months

### 2.2 Upgrading Subscription

1. **Calculate Remaining Value**: The system calculates remaining days and prorates the value
2. **Value Conversion**: Remaining value is converted to days on the new plan
3. **New Expiration**: New plan expires = Today + Converted Days + Purchased Period Days
4. **Effective Time**: Upgrade takes effect immediately

### 2.3 Downgrading Subscription

1. **Delayed Effect**: Downgrade activates the day after your current plan expires
2. **Continue Enjoying**: You continue enjoying all higher-tier benefits until expiration

---

## 3. Quota Refresh Mechanism

### 3.1 Daily AI Calls

- **Refresh Time**: Automatically refreshes daily at 00:00 Beijing Time (UTC+8)
- **Refresh Rule**: Daily used count resets to 0

### 3.2 Monthly Generation Quota

- **Refresh Time**: Refreshes on your personal billing anchor day
- **Refresh Rule**: Monthly quota resets to your current plan's limits

---

## 4. Quota Booster Packs

| Tier | Price | Document Credits | Image Credits | Audio Credits | Video Credits | Validity |
|:---:|:-----:|:----------------:|:-------------:|:-------------:|:-------------:|:--------:|
| Starter | $3.98 | 30 | 30 | 10 | 10 | Permanent |
| Standard | $9.98 | 100 | 100 | 30 | 30 | Permanent |
| Premium | $29.98 | 300 | 300 | 100 | 100 | Permanent |

**Deduction Policy**: Monthly subscription quota is consumed first, then addon pack credits.

---

## 5. Refund Policy

- Subscription services are non-refundable once activated
- Addon packs are non-refundable once purchased

---

## 6. Contact Us

For questions, please contact: support@aigenerator.com`;

export function SubscriptionRulesDialog({ open, onOpenChange, isDomestic }: SubscriptionRulesDialogProps) {
  const content = isDomestic ? domesticRules : internationalRules;
  const title = isDomestic ? "订阅规则" : "Subscription Terms";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="h-[60vh] overflow-y-auto pr-4">
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <pre className="whitespace-pre-wrap font-sans text-sm">{content}</pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
