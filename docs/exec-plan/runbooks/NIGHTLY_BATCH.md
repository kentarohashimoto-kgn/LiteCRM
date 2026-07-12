# 夜間バッチ runbook（方針A / Claude Code方式）

> **この文書は、毎晩 03:00 JST に起動する Claude Code セッションが実行する手順書**。
> AI生成はこのセッション自身が行う（消費 = Claudeサブスク枠、従量課金ゼロ）。
> 起動は Claude Code Remote の Routine(cron)。設計背景は `docs/SALES_AUTOMATION_DESIGN_2026-07.md` §7。
>
> **固定パラメータ**
> - Supabase project_id: `beztpddkezjlrlixjjqq`（プロジェクト `catorce-sales-os`）
> - tenant_id: `00000000-0000-0000-0000-000000000001`
> - タイムゾーン: 実行環境はUTC。「本日(JST)」= `(now() at time zone 'Asia/Tokyo')::date`。03:00 JST = 前日18:00 UTC。
> - 1晩の処理上限: **議事録要約 = 最大10件/晩**（平均3〜5件想定）。超過は翌晩へ繰り越し。

---

## 0. 前提チェック（最初に必ず）

1. **Supabase MCP が使えるか確認**（`mcp__Supabase__execute_sql` 等）。使えなければ、生成も記録もできない。
   → その場合は Slack（`mcp__Slack__slack_send_message`, あれば）に「夜間バッチ: Supabase MCP不可で中止」と通知し、**何も書き込まず終了**。
2. 利用枠に注意。処理中にレート制限/枠到達を感じたら、その時点で打ち切り、残りは `deferred_count` に記録して `limit_hit=true` でログする（§4）。

---

## 1. ジョブ一覧（この順で実行）

| 順 | job_kind | 対象 | 生成物 | 書き戻し先 |
|---|---|---|---|---|
| 1 | `meeting_summary` | 議事録テキスト有り＆未要約の商談（最大10件） | 議事録要約＋次アクション | `meetings.ai_summary` |

> 今後ここに `briefing`（翌日アポの事前ブリーフ / WO-15）、`followup_draft`（お礼・資料のGmail下書き / WO-11後半）、`knowledge_extract`（ノウハウ抽出 / WO-13）を追加していく。追加時も本runbookの「対象抽出→生成→書き戻し→batch_runs記録」の型を踏襲する。

---

## 2. job: meeting_summary（議事録要約）

### 2.1 対象抽出（最大10件、古い順）
```sql
select m.id, m.title, m.meeting_date, m.minutes_detail,
       o.name as opp_name, a.name as acc_name
from public.meetings m
left join public.opportunities o on o.id = m.opportunity_id
left join public.accounts a on a.id = m.account_id
where m.tenant_id = '00000000-0000-0000-0000-000000000001'
  and coalesce(length(btrim(m.minutes_detail)),0) >= 30
  and (m.ai_summary is null or btrim(m.ai_summary) = '')
order by m.meeting_date asc nulls last, m.created_at asc
limit 10;
```
- 0件なら job はスキップ（batch_runs に targets_total=0, status='success' で1行だけ残す）。

### 2.2 生成（このセッションが実行）
各商談について、議事録本文から次フォーマットの日本語要約を作る。**推測で補わず、議事録に書かれている内容だけ**を使う（既存 `generateMeetingSummaryAction` と同じ方針）。

```
## 要点
- (3〜6個の箇条書き)
## 顧客の課題・関心
- (箇条書き)
## 決定事項
- (なければ「なし」)
## 宿題・次アクション
- (担当と期日が分かれば含める)
## リスク・懸念
- (なければ「なし」)
```

### 2.3 書き戻し（人の関所の手前まで）
- `meetings.ai_summary` に要約本文、`meetings.ai_summary_at = now()` を保存。
- **`meetings.next_action_text/next_action_date` や案件は自動更新しない**（人がアプリ上で確認して反映）。＝ai_summary は「下書き」に相当。
```sql
update public.meetings
set ai_summary = $1, ai_summary_at = now(), updated_at = now()
where id = $2 and tenant_id = '00000000-0000-0000-0000-000000000001';
```
- 1件失敗しても他は続行（items_failed を+1して次へ）。

---

## 3. 通知（任意）
- Slack MCP が使えれば、担当別に「今朝の確認: 議事録要約 N件」を送る（`mcp__Slack__slack_send_message`）。
- 使えなければスキップ（記録は batch_runs に残るのでアプリからも確認可能）。

---

## 4. batch_runs への記録（**必須・最後に必ず1行**）

各 job_kind ごとに1行。開始時に `status='running'` で作ってもよいが、最小構成は終了時に確定行を1本 insert する。

```sql
insert into public.batch_runs
  (tenant_id, job_kind, run_date, started_at, ended_at, status,
   targets_total, items_generated, items_failed, deferred_count,
   limit_hit, limit_hit_at, usage_note, detail)
values
  ('00000000-0000-0000-0000-000000000001', 'meeting_summary',
   (now() at time zone 'Asia/Tokyo')::date,
   $started_at, now(),
   $status,                     -- 'success'（全件成功/0件） | 'partial'（一部失敗or繰り越し） | 'error'
   $targets_total, $items_generated, $items_failed, $deferred_count,
   $limit_hit, $limit_hit_at,
   $usage_note,                 -- 例: '10件中10件生成。レート制限なし。体感トークン中程度。' 枠到達時は必ずその旨を書く
   $detail::jsonb);             -- 例: {"meeting_ids":[...], "skipped":0}
```

**usage_note の書き方（ユーザー要望c の元データ）**
- トークン数の正確値はセッションからは取得できないため、**自己申告の定性メモ**を残す：処理件数、レート制限/枠到達の有無とタイミング、体感の重さ。
- **枠に到達したら必ず** `limit_hit=true` / `limit_hit_at=now()` / 繰り越し件数を `deferred_count` に。これが週次レビュー（`WEEKLY_USAGE_REVIEW.md`）で「いつ・何回 枠に当たったか」に集計される。

---

## 5. 冪等性・安全
- 対象条件（未要約のみ）により、再実行しても二重生成しない。
- 破壊的操作は行わない（ai_summary への追記のみ、既存本文の上書きなし）。
- service роль的な強権限で走るため、`tenant_id` フィルタを**必ず**付ける（他テナント混入防止）。
