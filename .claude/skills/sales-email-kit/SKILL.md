---
name: sales-email-kit
description: >
  Compose the recurring sales emails sent BEFORE and AFTER a 商談 for CATORCE:
  アポ日程調整/確認, 事前資料送付, 商談後のお礼＋資料送付, 提案書・見積送付,
  検討フォロー/追客, 次回アポ打診, 保留・失注後のナーチャリング, 汎用資料送付.
  Trigger phrases: "◎◎に提案書送付メール", "◎◎へ次回アポ打診", "◎◎に日程調整メール",
  "◎◎の検討フォロー(催促)メール", "◎◎に資料送って", "商談前/後のメール".
  Pulls context from the CATORCE CRM (and tldv), inserts the shared assets
  (references/assets.md — single source of truth for links/attachments), and picks
  the OUTPUT MODE by who handles the deal: 橋本 → create a Gmail draft; 他の営業マン
  → return TEXT ONLY. For the お礼メール specifically, the focused skill
  post-meeting-thankyou-email may be used; both share the same assets and rules.
---

# Sales email kit (営業の前後メール・資料送付)

One place for the emails that repeat around every 商談. Same context-gathering,
same shared assets, same output-mode rule — only the body template changes per type.

## Shared assets (資料リンク／添付)

Always read **`references/assets.md`** and paste the `状態=有効` links verbatim.
That file is the single source of truth; it is updated over time as materials change.
Current standard service-examples link (paste the full URL, unmodified):

```
▼サービス事例
https://ai202504.my.canva.site/ai-20260602
```

## Context gathering (共通)

- Identify the 案件/会社. If hard to locate (BT/アポ代行 booking by company name),
  use the **sales-meeting-lookup** skill.
- Read from CRM `catorce-sales-os` (Supabase project `beztpddkezjlrlixjjqq`):
  `meetings.minutes_detail`/`summary`, `opportunities.next_action_text`/`next_action_date`/
  `proposed_solution`/`amount`/`stage`, and `contacts` for the recipient address.
- If議事録 is missing, pull the tldv transcript and summarize first.

## OUTPUT MODE (who handles the deal?)

Check `opportunities.owner_user_id` / `meetings.owner_user_id` (ask if ambiguous):

- **橋本健太郎** (`dd21a355-05c4-4132-899b-f321873b42d3`, kentaro.hashimoto@catorce.jp)
  → **create a Gmail draft** (`mcp__Gmail__create_draft`), `cc: mako.hiraishi@catorce.jp`,
  橋本 signature. If the client address is unknown, leave `to` empty and flag it.
- **他の営業マン** (橋本以外: 辰巳・村上・君嶋・深瀬・石川 等)
  → **return PLAIN TEXT only, no Gmail draft** (connected mailbox is 橋本's).
  Use a `（署名：担当者名）` placeholder.

## Email types (件名テンプレ ＋ 本文骨子)

### 1. アポ日程調整 / 面談確認（事前）
- 件名: `【ご面談日程のご確認】株式会社カトルセ`
- 骨子: 接点の御礼 → 日時候補/確定 → 場所/ZoomURL → 所要時間・当日の狙い → 結び。

### 2. 事前資料 / アジェンダ送付（事前）
- 件名: `【株式会社カトルセ】◎/◎ お打ち合わせの事前資料`
- 骨子: 挨拶 → 当日アジェンダ(3点) → 事前共有資料（assets.md）→ 事前確認事項。

### 3. 商談後のお礼＋資料送付（事後）
- 件名: `【株式会社カトルセ】本日の御礼と資料のご送付（〜のご相談）`
- 骨子: 御礼 → 本日の振り返り(先方ニーズ3〜5点=議事録) → 本日の資料(assets.md) →
  次アクション(提案送付予定など) → 研修絡みは人材開発支援助成金(今年度まで) → 署名。
- ※お礼特化は `post-meeting-thankyou-email` skill と同一ルール。

### 4. 提案書・見積送付（事後）
- 件名: `【株式会社カトルセ】ご提案書・お見積りのご送付`
- 骨子: 御礼 → 議事録を踏まえた提案要点 → **添付/リンクの提案書・見積の明示** →
  複数案がある場合は各案の違いを1行ずつ → 検討いただきたい観点(予算・時期・人数) →
  次アクション(◯日頃にご状況伺い) → 署名。
- 金額は正式見積側に記載。本文では案の骨子とねらいを簡潔に。

### 5. 検討フォロー / 追客（催促）（事後）
- 件名: `【株式会社カトルセ】ご検討状況のお伺い`
- 骨子: 前回の御礼 → 「その後ご状況いかがでしょうか」 → 追加でお役立ちできる点1つ →
  返信ハードルを下げる一言(短いお電話でも可 等) → 署名。しつこさを避け簡潔に。

### 6. 次回アポ打診（事後）
- 件名: `【株式会社カトルセ】次回お打ち合わせの日程について`
- 骨子: 御礼 → 次回で扱いたいテーマ(デモ/提案/上席同席 等) → 日時候補2〜3 →
  所要時間 → 署名。CRMの`next_action`と整合させる。

### 7. 保留・失注後のナーチャリング（事後）
- 件名: `【株式会社カトルセ】その後のご状況と最新のAI活用事例`
- 骨子: ご無沙汰の挨拶 → 近況の価値提供(最新事例/セミナー=assets.md) →
  再検討のきっかけ提示 → 低圧の結び。

### 8. 汎用 資料送付（随時）
- 件名: `【株式会社カトルセ】資料のご送付`
- 骨子: 挨拶 → 依頼/約束の資料をリンクで(assets.md) → 補足1点 → 署名。

## 橋本の署名

```
──────────────────────
株式会社カトルセ
橋本 健太郎
kentaro.hashimoto@catorce.jp
──────────────────────
```

## 送付後（任意）
- 客先アドレスが判明したら CRM `contacts` にメール登録を提案。
- `meetings` / `opportunities.next_action_*` を更新して整合を取る。

## この Skill の高度化
- 資料が変わったら **references/assets.md** を編集（メール種別は触らない）。
- 新しいメール種別が定着したら「Email types」に節を追加。
- 会社/テーマ別の言い回しパターンが溜まったら、assets.md に条件付きで追記。
