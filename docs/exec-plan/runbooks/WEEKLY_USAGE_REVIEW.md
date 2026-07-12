# 週次トークン使用実績レビュー runbook（ユーザー要望c）

> **この文書は、毎週月曜 08:00 JST に起動する Claude Code セッションが実行する手順書**。
> 目的: 夜間バッチ（方針A）が **週次のサブスク利用枠にいつ・何回到達したか / 夜間処理の割合 / 処理量の推移** を振り返り、
> 1晩の上限や実行時刻を調整する材料を出力する。設計背景は `docs/SALES_AUTOMATION_DESIGN_2026-07.md` §7。
>
> **固定パラメータ**: project_id `beztpddkezjlrlixjjqq` / tenant_id `00000000-0000-0000-0000-000000000001`

---

## 1. 直近8週の集計（batch_runs から）
```sql
with w as (
  select
    date_trunc('week', run_date)::date as week_start,
    count(*)                                             as runs,
    count(*) filter (where job_kind <> 'weekly_usage_review') as job_runs,
    sum(targets_total)   as targets,
    sum(items_generated) as generated,
    sum(items_failed)    as failed,
    sum(deferred_count)  as deferred,
    count(*) filter (where limit_hit)          as limit_hit_runs,
    min(limit_hit_at) filter (where limit_hit) as first_limit_hit_at
  from public.batch_runs
  where tenant_id = '00000000-0000-0000-0000-000000000001'
    and run_date >= (now() at time zone 'Asia/Tokyo')::date - interval '56 days'
  group by 1
)
select * from w order by week_start desc;
```

## 2. 枠到達の明細（いつ・どのジョブで当たったか）
```sql
select run_date, job_kind, started_at, limit_hit_at, deferred_count, usage_note
from public.batch_runs
where tenant_id = '00000000-0000-0000-0000-000000000001'
  and limit_hit
  and run_date >= (now() at time zone 'Asia/Tokyo')::date - interval '56 days'
order by run_date desc, limit_hit_at desc;
```

## 3. 夜間割合（参考）
- 現状は全ジョブが夜間実行のため夜間割合=100%。将来、方針B（API即時）やユーザーの日中手動実行が混ざったら、
  `detail->>'trigger'`（'nightly'|'manual'|'api'）で区別して割合を出す。夜間runbook側で `detail` に `trigger` を入れておくこと。

## 4. 出力（人が読む形）
次のサマリを作り、**(a) Slackへ送信**（`mcp__Slack__slack_send_message`、あれば）し、**(b) batch_runs に1行記録**（job_kind='weekly_usage_review', detail に集計JSONを格納）する。

出力に含める項目:
- 今週の処理件数（生成/失敗/繰り越し）と先週比
- **枠到達の回数とタイミング**（何曜の何時ごろか）
- 夜間割合
- 調整提案（例: 「火曜に枠到達が続く → 1晩上限を10→7に下げる」「繰り越しが常態化 → 実行時刻を早める / 隔晩に分割」）

```sql
insert into public.batch_runs
  (tenant_id, job_kind, run_date, started_at, ended_at, status, detail, usage_note)
values
  ('00000000-0000-0000-0000-000000000001', 'weekly_usage_review',
   (now() at time zone 'Asia/Tokyo')::date, now(), now(), 'success',
   $summary_json::jsonb, $human_summary_text);
```

## 5. 前提チェック
- Supabase MCP が使えなければ中止（Slackに通知のみ）。破壊的操作は一切しない（読み取り＋自身のログ1行のみ）。
