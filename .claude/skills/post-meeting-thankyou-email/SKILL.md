---
name: post-meeting-thankyou-email
description: >
  Draft a post-meeting thank-you / follow-up email to a 商談相手 (client contact)
  after a sales meeting. Trigger phrases: "商談相手◎◎へのお礼メール作って",
  "◎◎社にお礼メール", "商談後のお礼メール", "打ち合わせのお礼と資料送付メール".
  Pulls the meeting context from the CATORCE CRM (and tldv if needed), composes a
  Japanese follow-up email (御礼＋振り返り＋資料＋次アクション), and chooses the OUTPUT
  MODE based on who handled the meeting: if the 対応者 is 橋本健太郎, create a Gmail
  DRAFT in his account; if the 対応者 is a different 営業マン (sales rep), return
  TEXT ONLY (no Gmail draft), because the connected Gmail account is 橋本's.
---

# Post-meeting thank-you / follow-up email

Reusable flow for "商談相手◎◎へのお礼メール作って".

## 1. Gather the meeting context

- Identify the 案件/商談. If the user refers to it by client company name and it's hard
  to find (BT/アポ代行 booking), use the **sales-meeting-lookup** skill first.
- Read the context from the CRM (`catorce-sales-os`, Supabase project `beztpddkezjlrlixjjqq`):
  - `meetings.minutes_detail` / `summary` (the議事録) for the target `opportunity_id`
  - `opportunities.next_action_text` / `next_action_date` / `proposed_solution`
- If no議事録 is stored yet, pull the tldv transcript and summarize first
  (see sales-meeting-lookup for finding the recording), then optionally reflect it
  into the CRM `meetings` row.

## 2. Decide the OUTPUT MODE (who handled the meeting?)

Check the 対応者 = `opportunities.owner_user_id` / `meetings.owner_user_id`
(or just ask the user "対応は橋本さんですか？営業担当ですか？" if ambiguous).

- **対応者 = 橋本健太郎** (`dd21a355-05c4-4132-899b-f321873b42d3`,
  kentaro.hashimoto@catorce.jp) → **Create a Gmail draft** with
  `mcp__Gmail__create_draft`.
  - `cc`: `mako.hiraishi@catorce.jp` (橋本's standing habit on client mail)
  - `to`: the client contact's address. If it's not in CRM/Gmail (common for
    BT-arranged first meetings), **leave `to` empty** and tell the user the address
    must be filled before sending.
  - Use 橋本's signature (below).
- **対応者 = 別の営業マン** (辰巳・村上・君嶋・深瀬・石川 等、橋本以外) →
  **Return the email as PLAIN TEXT only. Do NOT create a Gmail draft.**
  The connected Gmail mailbox is 橋本's, so drafting another rep's client mail there
  is wrong. Give the rep copy-paste-ready text with a signature placeholder
  (`（署名：担当者名）`) so they can send it from their own account.

## 3. Compose the email (structure)

- 件名: `【株式会社カトルセ】本日の御礼と資料のご送付（〜のご相談）`
- 宛名: `株式会社◎◎ / ご担当者様`
- 本文の骨子:
  1. 御礼（時間をいただいたこと）
  2. 本日の振り返り（先方の状況・ニーズを3〜5点で要約＝議事録から）
  3. 本日ご説明した資料（下記「共有アセット」＋当日固有資料）
  4. 次アクション（提案書・見積の送付予定など。まだ提案送付前なら「追ってお送りします」）
  5. 研修が絡む場合は人材開発支援助成金の活用に触れる（今年度まで）
  6. 結び＋署名
- トーン: 丁寧・簡潔。金額など生々しい条件は、正式見積を別途送る前提なら本文に書かず
  「2案でご提案・お見積りを追ってお送りします」に留める。

## 共有アセット / 定型

- サービス事例（Canva）: `https://ai202504.my.canva.site/ai-20260602`
  ※橋本が直近の客先メールで使っている標準リンク。**最新版か直近のSENTメールで確認**してから使う。
- 橋本の署名:
  ```
  ──────────────────────
  株式会社カトルセ
  橋本 健太郎
  kentaro.hashimoto@catorce.jp
  ──────────────────────
  ```

## 4. After drafting (optional)

- 客先アドレスが判明したら CRM `contacts` にメールを登録することを提案する。
- 必要なら商談ログ（`meetings`）や `opportunities.next_action_*` を更新して整合を取る。
