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
> - **対象の下限（直近N日ポリシー / ユーザー決定 2026-07-12）**: `RECENT_DAYS = 7`。開催が直近7日以内（`meeting_date >= JST今日 - 7日`）の商談のみを対象とし、それ以前は対象外（枠コストを最小化しつつ late 入力の取りこぼしを防ぐ）。値の変更はこの1箇所を直す。
>   - 商談後1〜2日で議事録が入る運用に対し7日の余裕を持たせる。もっと絞るなら3、緩めるなら14/30。
>   - リサーチ/ブリーフィング(将来のjob)は本来「翌日アポ」を対象にするため、この下限は自然に満たす（登録日では絞らない）。
> - **実行方式 = F1 ingest API（2026-07-12 実証で確定）**: フレッシュ起動の夜間セッションには Supabase MCP が繋がらないため、DB読み書きはアプリのAPIに委譲する。
>   - エンドポイント: `${APP_URL}/api/batch/meeting-summary`（APP_URL 既定 `https://litecrm.vercel.app`）
>   - 認可ヘッダ: `Authorization: Bearer ${CRON_SECRET}`（値は環境変数 or 起動プロンプトで受け取る。リポジトリには置かない）
>   - セッションは **Supabase MCP を使わない**。`curl`(Bash) か WebFetch で GET/POST するだけ。生成はセッション自身（サブスク枠）。

---

## 0. 実行方式（F1 ingest API・正）

> **スタート/停止制御（2026-07-12〜）**: 各ジョブの実行可否はアプリの「AIバッチ運用」画面
> （`batch_job_settings` テーブル）で制御される。**実行前に必ず確認**すること:
> - F1経路: GETが `{enabled:false, targets:[]}` を返したら**そのジョブは何も生成せず終了**
>   （POSTも409で拒否される）。
> - MCP保持セッション(F2)の場合: `select job_kind, enabled from batch_job_settings where tenant_id='00000000-0000-0000-0000-000000000001'`
>   を最初に実行し、`enabled=false` のジョブはスキップ（batch_runs にも書かない）。
> - 現在: `meeting_summary`=稼働 / `na_task_draft`=停止 / `content_draft`=**停止（記事品質の改善まで・ユーザー指示 2026-07-12）**

夜間セッションは **Supabase MCP を使わず**、次の2ステップで処理する。SQLは打たない（DB操作はAPI内で完結）。

```bash
# 1) 対象取得（最大10件）
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  "$APP_URL/api/batch/meeting-summary?limit=10"
#   → {ok:true, targets:[{meeting_id, title, opp_name, acc_name, minutes_detail}, ...]}

# 2) 各 target を自分(サブスク枠)で要約(§2.2の形式) してから、まとめて書き戻し
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
  "$APP_URL/api/batch/meeting-summary" \
  -d '{"items":[{"meeting_id":"...","ai_summary":"## 要点\n- ..."}],
       "trigger":"nightly","usage_note":"10件中10件生成。レート制限なし。"}'
#   → {ok:true, generated:N, failed:M, batch_run_id:"..."}  ※書き戻しと batch_runs 記録はAPIが実施
```

- API未応答/401/503なら **何も生成せず終了**（可能ならユーザーへ理由を報告）。
- 利用枠に注意。レート制限/枠到達を感じたら打ち切り、POSTの `deferred_count`/`limit_hit`/`limit_hit_at` に記録（§4はAPIが担当）。
- **F2（常設セッション/MCP保持時）に限り**、以下 §2.1/§2.3/§4 の SQL を直接実行してよい（参考）。

---

## 1. ジョブ一覧（この順で実行）

| 順 | job_kind | 対象 | 生成物 | 書き戻し先 | 状態 |
|---|---|---|---|---|---|
| 1 | `meeting_summary` | 議事録テキスト有り＆未要約＆直近7日開催の商談（最大10件） | 議事録要約 | `meetings.ai_summary` | `batch_job_settings` に従う（現在: 稼働） |
| 2 | `na_task_draft` | 手順1で新たに要約された商談（ai_summary_at が直近24h） | 次アクションのタスク下書き | `tasks`(origin='ai_meeting') | `batch_job_settings` に従う（現在: **停止**） |
| 3 | `content_draft` | 記事ネタで status='selected' ＆本文未作成（最大5件/晩＝1日5本） | SEO記事ドラフト(Markdown) | `content_ideas.body_md`(status→drafting, design_status→ready) | `batch_job_settings` に従う（現在: **停止**・記事品質の改善まで） |

> 今後ここに `followup_draft`（お礼・資料のGmail下書き / WO-11後半）、`briefing`（翌日アポの事前ブリーフ / WO-15）、`knowledge_extract`（ノウハウ抽出 / WO-13）を追加していく。追加時も本runbookの「対象抽出→生成→書き戻し→batch_runs記録」の型を踏襲する。
>
> **有効化ゲート**: job 2 以降は、job 1（meeting_summary）が夜間フレッシュセッションで**MCP疎通OK**（batch_runs に heartbeat/nightly 行が残る）を確認してから trigger プロンプトに組み込む。それまでは job 1 のみ。

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
  and m.meeting_date >= (now() at time zone 'Asia/Tokyo')::date - interval '7 days'  -- RECENT_DAYS=7
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

## 2B. job: na_task_draft（次アクションのタスク下書き）※疎通確認後に有効化

**目的**: 議事録要約(手順1)から「宿題・次アクション」を拾い、既存 `tasks` に **AI下書きタスク**として起票。営業は翌朝アプリで確認→確定/修正/削除。**メール送信・案件更新はしない**。

### 2B.1 対象抽出（手順1で今回要約された商談）
```sql
select m.id as meeting_id, m.opportunity_id, m.account_id, m.owner_user_id, m.ai_summary,
       o.name as opp_name, a.name as acc_name
from public.meetings m
left join public.opportunities o on o.id = m.opportunity_id
left join public.accounts a on a.id = m.account_id
where m.tenant_id = '00000000-0000-0000-0000-000000000001'
  and m.ai_summary_at >= now() - interval '24 hours'
  and coalesce(btrim(m.ai_summary),'') <> ''
  -- 冪等性: 同じ商談に対しAI下書きタスクが未作成のものだけ
  and not exists (
    select 1 from public.tasks t
    where t.tenant_id = m.tenant_id and t.origin = 'ai_meeting'
      and t.opportunity_id = m.opportunity_id
      and t.created_at >= m.ai_summary_at
  );
```

### 2B.2 生成（このセッション）
- ai_summary の「## 宿題・次アクション」から、実行すべきタスクを **0〜3件** 抽出（無ければ作らない）。
- 各タスク: `title`(命令形で簡潔) / `description`(背景1〜2行＋「AI下書き・要確認」明記) / `due_date`(期日が読めれば。読めなければ null)。

### 2B.3 書き戻し（下書きとして）
- **実行前に必ず** `tasks` の `status`/`priority` の許容値を実データで確認（`select distinct status, priority from public.tasks limit 50;`）してから、その値域に合わせて insert する（enum/NOT NULL 事故防止）。
- `origin='ai_meeting'` を必ず付与（＝AI由来の識別）。可能なら `labels` に `'AI下書き'` を追加（アプリで絞り込み・確認しやすくする）。
- `assigned_to = m.owner_user_id`、`opportunity_id`/`account_id` を紐付け、`created_by` は NULL（無人）。
```sql
insert into public.tasks (tenant_id, opportunity_id, account_id, assigned_to, created_by,
  title, description, due_date, status, priority, origin, labels)
values ('00000000-0000-0000-0000-000000000001', $opp, $acc, $owner, null,
  $title, $desc, $due, $status_default, $priority_default, 'ai_meeting',
  array['AI下書き']);
```
- 1件失敗しても続行。作成件数を batch_runs(job_kind='na_task_draft') に記録。

---

## 2C. job: content_draft（SEO記事ドラフト生成）※疎通確認後に有効化

**目的**: `/app/content` で「選定(selected)」にした記事ネタから、SEOブログ記事のドラフト(Markdown)を夜間に執筆する（方針A＝このセッション自身が書く。外部APIは使わない）。人が翌朝 CRM上で確認し、Claudeデザインへ連携（または手動コピペ）する。

**実行（F1 ingest API経由・SQL不要）**:
```bash
# 1) 対象取得（最大5件 = 1日5本）
curl -s -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/batch/content-draft?limit=5"
#   → {ok:true, targets:[{id, title, theme, angle, target_keyword, note}, ...]}

# 2) 各 target について、このセッションがSEO記事を執筆して書き戻し
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
  "$APP_URL/api/batch/content-draft" \
  -d '{"items":[{"id":"...","body_md":"# タイトル\n\n..."}],"trigger":"nightly","usage_note":"5本執筆。"}'
#   → 書き戻し(status→drafting, design_status→ready)と batch_runs 記録はAPIが実施
```

**執筆ガイド（プロンプト方針）**:
- 想定読者は `angle`（誰に何を）に従う。`target_keyword` を見出し・冒頭に自然に含める（詰め込み禁止）。
- 構成: H1タイトル → 導入(読者の課題共感) → H2×3〜5(具体例・手順・事例) → まとめ＋CTA(カトルセのAI研修/SUISHIN等への自然な導線)。
- 分量目安 2,000〜3,500字。日本語。事実の捏造禁止（不確かな統計・固有名詞は書かない。一般論と自社ナレッジ(knowledge_entries)の範囲で）。
- Markdownのみ（HTML不可）。冒頭に `# タイトル`。

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
