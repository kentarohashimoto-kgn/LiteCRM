# メール連携・トラッキング/シーケンス ＆ ワークフロー自動化 詳細仕様書（2026-07）

> **目的**: 競合比較で「乗り換え障壁の最大要因」とされた2機能を、現行コードベースの既存資産に接続する形で詳細化する。
> - **F-101 メール連携・トラッキング/シーケンス**（特大 / 乗り換え障壁の最大要因）
> - **F-102 ワークフロー自動化（ユーザー定義ルール）**（大 / 「ヨミC転落→Slack」等の軽量Flow）
>
> **前提資料**: `docs/SALES_AUTOMATION_DESIGN_2026-07.md`（AI/バッチ方針・§7）/ `docs/PRODUCT_GAP_ANALYSIS_2026-07.md`（F7=メール連携, C-01=通知）/ `docs/CURRENT_SPEC_2026-07.md`（as-is）
> **作成日**: 2026-07-18 / 対象ブランチ: `claude/email-workflow-automation-spec-ueyrcz`
> **本書はコード変更を含まない設計・意思決定文書**。合意後にワークオーダー（WO-18〜）へ分解して実装する。

---

## 0. 先に結論

1. **F-102（ワークフロー自動化）は既存資産の直系で組める** —「ヨミC転落→Slack」の**検知源はすでに本番稼働中**。
   `yomi_change_logs`（`0126`）が **全画面横断・DBトリガーでヨミ変更を自動記録**しており、from/to・変更者・時刻が揃っている。走査対象として理想的。
   出力側も `notifications`（アプリ内ベル・`0071`）と Slack Webhook 送信（`/api/cron/daily-digest`）が実装済み。
   **発火は「バッチ方式」で確定（ユーザー決定 2026-07-18）**: 日次/短間隔cronで変更ログを走査→ルール評価→アクション。既存 daily-digest の拡張で低リスク・準リアルタイム。

2. **F-101（メール連携）は3サブ機能に分解**し、価値と工数のバランスで段階導入する。
   - **F-101a メールログ連携** … Gmail送受信を顧客/商談のタイムライン（`activities.type='email'`）へ自動記録。
   - **F-101b シーケンス（追客カデンス）** … 多段フォローを定義、返信/アポ確定で自動停止。**乗り換え障壁の本丸**。
   - **F-101c 開封/クリック・トラッキング** … 提案書の開封・リンククリック検知。ヨミ・危険案件判定へ接続。

3. **メール送信は「下書き→人が手動送信」を既定**（`SALES_AUTOMATION_DESIGN` §3・確定原則。誤送信・誤情報を構造で封じる）。
   これによりF-101bは「**送信キューに積む→ワンクリック送信**」の半自動が現方針との落としどころ。完全自動送信は採らない。
   ※開封トラッキング（F-101c）は自前送信経路が前提のため、送信方針の確定が先行論点（§3.3・§6）。

4. **F-102を先行、F-101を後続**を推奨（既存 `yomi_change_logs` に載る分、最短で体感が出る）。着手順は§7・§8で提案。

---

## 1. 全体像 — 「イベント→ルール→アクション」の共通基盤に寄せる

F-101（メール）とF-102（ワークフロー）は別機能に見えるが、**「業務イベントを捉えて自動で何かする」骨格を共有**する。
将来の重複実装を避けるため、**F-102のルールエンジンを共通の実行基盤**とし、F-101のメール系アクション（下書き作成・シーケンス投入）を **F-102のアクションの一種**として接続できる形にする。

```
┌─────────────────────────────────────────────────────────────────────┐
│ 【イベント源】既存の変更ログ・状態                                       │
│  yomi_change_logs / stage_histories / opportunities(次回AC・金額)        │
│  tasks / leads / notifications生成箇所 / (F-101)email_events            │
└───────────────────────────────▼─────────────────────────────────────┘
                    日次/短間隔 cron が走査（バッチ方式・確定）
┌───────────────────────────────▼─────────────────────────────────────┐
│ 【ルールエンジン】F-102  automation_rules（WHEN→IF→THEN）               │
│  トリガー種別ごとに対象を抽出 → condition_json で絞り込み → action実行     │
└───────────────────────────────▼─────────────────────────────────────┘
        ┌───────────────┬───────────────┬───────────────┬──────────────┐
        ▼               ▼               ▼               ▼              ▼
   Slack通知       アプリ内通知     タスク自動起票    メール下書き     項目更新/再割当
 (SLACK_WEBHOOK)  (notifications)   (tasks.origin)  (F-101/Gmail)  (opportunities)
```

**設計思想**: 検知源は作らず**既存ログを使う**。アクションも既存の出力口（Slack/notifications/tasks）を**部品化**して再利用。新規はルールの「定義テーブル・評価ロジック・設定UI」に集中させる。

---

## 2. 前提：接続できる既存資産（実査 2026-07-18）

| 資産 | 実体 | 本仕様での用途 |
|---|---|---|
| `yomi_change_logs`（`0126`） | ヨミ変更をDBトリガー `trg_opps_yomi_log` で全画面横断・自動記録。`from_yomi/to_yomi/changed_by/changed_at` | **F-102 トリガー「ヨミ変更」の主データ源** |
| `stage_histories`（`0001`/`0002`） | ステージ遷移履歴 | F-102 トリガー「ステージ変更」 |
| `sales_alerts`（`0044`）＋ `STALE_DAYS=7`/`PROPOSAL_FOLLOWUP_DAYS=7`（`constants.ts`） | 放置/次回AC超過/提案フォロー漏れの検知RPC | F-102 時間条件トリガー |
| `notifications`（`0071`） | アプリ内通知（ベル・未読）。テナント内メンバー宛にinsert可 | F-102/F-101 アクション「アプリ内通知」 |
| `/api/cron/daily-digest` | `CRON_SECRET`認可＋`getSupabaseAdmin()`（service role）＋`SLACK_WEBHOOK_URL`送信の実装済みパターン | **F-102 バッチ発火の雛形**・Slack送信 |
| `batch_runs`（`0104`）/ `batch_job_settings`（`0124`） | バッチ運用ログ＋ジョブON/OFF制御 | F-102/F-101バッチの運用ログ・停止スイッチ |
| `tasks.origin`（`0135`。既存値 `next_action`/`ai_meeting`） | タスクの発生源を区別 | F-102 アクション「タスク自動起票」（`origin='automation'`） |
| `activities`（`type='email'`。`constants.ts`） | 活動タイムライン。メール種別あり | **F-101a メールログの受け皿** |
| Gmail MCP `create_draft` / Google Calendar MCP | 下書き作成・日程 | F-101 メール下書き（送信は手動） |
| `solution_packages`（お土産/資料） | 提案パッケージ・資料 | F-101 資料送付下書きの選定元 |

**RLS/DB原則（踏襲）**: 全新規テーブルに `tenant_id uuid not null` ＋ RLS4点セット（select/insert/update/delete, `current_tenant_ids()`/`edit_tenant_ids()`/`view_all_tenant_ids()`）＋ `set_updated_at` トリガー。重い集計・cron系RPCは `SECURITY DEFINER` + 明示テナント + `search_path=public,pg_temp` 固定 + CRON/authenticated限定（`SALES_AUTOMATION_DESIGN` 付録）。

---

# F-102 ワークフロー自動化（ユーザー定義ルール）

## 3. F-102 詳細仕様

### 3.1 ルールモデル（WHEN → IF → THEN）

1件のルール＝「**トリガー種別（WHEN）**」×「**条件（IF, `condition_json`）**」×「**アクション列（THEN, `action_json`）**」。

**データモデル（新規・加算的）**
```
automation_rules（ルール定義）
  id, tenant_id, name,
  trigger_type text,          -- 'yomi_changed'|'stage_changed'|'next_action_overdue'
                              --  |'no_activity_days'|'amount_threshold'|'lead_created'|'task_assigned'
  condition_json jsonb,       -- トリガー種別ごとのスキーマ（§3.2）
  action_json jsonb,          -- アクション配列（§3.4）
  enabled boolean not null default true,
  run_scope text default 'tenant',   -- 将来: 特定オーナー/チームのみ等
  last_evaluated_at timestamptz,      -- バッチが最後に走査した時刻（増分走査の基準）
  created_by, created_at, updated_at

automation_runs（発火監査ログ）
  id, tenant_id, rule_id,
  fired_at timestamptz,
  trigger_ref text,           -- 例: yomi_change_logs.id（重複発火防止の冪等キー）
  target_type text, target_id uuid,   -- 対象（例: opportunity）
  status text,                -- 'success'|'skipped'|'error'
  actions_result jsonb,       -- 各アクションの成否
  created_at
```

- **冪等性**: `automation_runs(rule_id, trigger_ref)` に一意制約。同じヨミ変更ログ行に対する二重発火を防ぐ（バッチ再実行に強い）。
- **有効/停止**: `automation_rules.enabled` に加え、ジョブ全体は既存 `batch_job_settings`（`job_kind='automation'`）で一括停止できる。

### 3.2 トリガー・カタログ（WHEN）

| trigger_type | 検知源（既存） | 走査方法（バッチ） | condition_json 例 |
|---|---|---|---|
| `yomi_changed` | **`yomi_change_logs`** | `last_evaluated_at` 以降の新規行を走査 | `{ "to_in": ["3.C(30%)"], "direction": "down" }` |
| `stage_changed` | `stage_histories` | 同上（新規行） | `{ "to_in": ["proposal_sent"] }` |
| `next_action_overdue` | `opportunities.next_action_date` | 当日 cron で `next_action_date < today` を抽出 | `{ "overdue_days_gte": 3 }` |
| `no_activity_days` | `activities` 最終日時 | 当日 cron で N日無活動を抽出 | `{ "days_gte": 7, "yomi_in": ["1.A(80%)","2.B(50%)"] }` |
| `amount_threshold` | `opportunities.amount` × 状態変化 | 状態変化イベントに金額条件を重畳 | `{ "amount_gte": 5000000, "on": "lost" }` |
| `lead_created` | 新規リード生成箇所 | 当日 cron で新規リード | `{ "source_in": ["web_form"] }` |
| `task_assigned` | `tasks` 割当 | 割当イベント | `{ "assigned_to": "self" }` |

- **ヨミの「下方遷移(direction:down)」判定**: `YOMI_OPTIONS`（`constants.ts`）の並び順インデックスで from > to を評価（`0.受注`が最上位 … `7.オチ`が下位。番号順で単調でない点に注意し、**専用の順序マップを定義**する）。
- ご例示の**「ヨミC転落→Slack」= `yomi_changed` + `{to_in:["3.C(30%)"], direction:"down"}`**。「1.A / 2.B から 3.C に落ちた時だけ」を条件で表現できる。

### 3.3 条件（IF）

`condition_json` はトリガー種別ごとにスキーマを定義（上表）。MVPは **AND結合の単純条件**（`to_in` / `amount_gte` / `overdue_days_gte` / `owner_is` 等）。
OR・ネストは将来拡張。バリデーションは Zod スキーマ（トリガー種別→条件スキーマの対応表）でサーバー側検証。

### 3.4 アクション・カタログ（THEN, `action_json` は配列）

| action.type | 実現手段（既存） | パラメータ例 |
|---|---|---|
| `slack_notify` | `SLACK_WEBHOOK_URL` へ POST（daily-digestと同一経路） | `{ "template": "{account} が {to_yomi} に転落（担当 {owner}）", "channel": "default" }` |
| `app_notify` | `notifications` へ insert（本人/担当/管理系） | `{ "to": "owner", "title": "...", "href": "/app/opportunities/{id}" }` |
| `create_task` | `tasks`（`origin='automation'`） | `{ "title": "C転落のリカバリ策を検討", "due_in_days": 2, "assign": "owner" }` |
| `email_draft` | **F-101** Gmail `create_draft`（送信は手動） | `{ "template_id": "...", "to": "primary_contact" }` |
| `update_field` | `opportunities` 更新（監査ログ記録） | `{ "set": { "forecast_category": "pipeline" } }` |
| `reassign_owner` | `opportunities.owner_user_id`（`canReassignOwner`相当のガード） | `{ "to_user": "..." }` |

- **テンプレート変数**: `{account}` `{owner}` `{to_yomi}` `{from_yomi}` `{amount}` `{url}` 等をレンダラで差し込み。
- **Slackチャンネル振り分け**の論点: 現状 `SLACK_WEBHOOK_URL` は**単一チャンネル**。ルール別に投げ先を変えるには (a) 複数Webhook URLをテナント設定に持つ、(b) Slack Bot Token化（`chat.postMessage`）のいずれか。**MVPは単一チャンネル（default）**で開始し、振り分けは次段で追加。

### 3.5 発火方式（バッチ・確定）

`SALES_AUTOMATION_DESIGN` の cron 基盤を踏襲した **新規 cron**（例: `/api/cron/automation`）。

**処理フロー（1回の実行）**
1. `batch_job_settings(job_kind='automation')` が `enabled` か確認（停止中は即終了）。
2. 有効な `automation_rules` を取得。
3. トリガー種別ごとに対象を抽出:
   - ログ型（`yomi_changed`/`stage_changed`）… 各ルールの `last_evaluated_at` 以降の新規ログ行。
   - 状態型（`next_action_overdue`/`no_activity_days`/`amount_threshold`）… 当日スナップショットを評価。
4. `condition_json` で絞り込み → マッチした対象×ルールごとに:
   - `automation_runs(rule_id, trigger_ref)` の一意制約で**未発火のみ**処理（冪等）。
   - `action_json` を順に実行（1アクション失敗でも他は続行）。
5. `automation_rules.last_evaluated_at` を更新、`batch_runs`（`job_kind='automation'`）へ実行サマリを記録。

**スケジュール**: まずは `daily-digest` と同枠の**日次**で開始（低リスク）。体感を上げたい種別（ヨミ転落など）は **短間隔cron（例: 15〜30分）** に格上げ可能（Vercel Cron設定）。「準リアルタイム（数分〜1日）」の要件に合致。

**認可**: 既存同様 `Authorization: Bearer <CRON_SECRET>`（`checkBearer`）＋ `getSupabaseAdmin()`（service role, `deleted_at` 明示除外）。

### 3.6 UI（設定画面）

- **MVP=レシピ方式**（推奨）: 厳選テンプレを選んで有効化・パラメータ設定。
  - 初期レシピ例:
    1. **ヨミC転落 → Slack＋担当へアプリ内通知**（ご例示）
    2. 高額案件（≥500万）失注 → 本部へ通知＋リカバリ理由タスク
    3. 次回AC 3日超過 → 担当へ催促、7日で本部Cc
    4. 提案済のまま7日無活動 → フォロータスク自動起票
    5. Webフォーム新規リード → 担当割当＋初動タスク
- **将来=No-codeビルダー**: トリガー/条件/アクションを自由組み立て（`automation_rules` の汎用スキーマはこれを見越して設計済）。
- **一覧/監査**: ルール一覧（ON/OFF・最終発火）＋ `automation_runs` の発火履歴ビュー（誰に何が飛んだか）。設定は owner/admin（`can_edit_role` 相当）。

### 3.7 F-102 実現性

| 項目 | 可否 | 根拠 |
|---|---|---|
| ヨミ転落検知 | ◎ | `yomi_change_logs` 実装済 |
| Slack/アプリ内通知 | ◎ | Webhook・`notifications` 実装済 |
| タスク自動起票 | ◎ | `tasks.origin` 実装済 |
| バッチ発火・冪等・運用ログ | ◎ | `daily-digest`/`batch_runs`/`batch_job_settings` 踏襲 |
| Slackチャンネル振り分け | ○ | 複数Webhook or Bot token化（MVPは単一） |
| No-codeビルダーUI | ○ | 新規実装（MVPはレシピで回避） |

---

# F-101 メール連携・トラッキング/シーケンス

## 4. F-101 詳細仕様

### 4.1 F-101a メールログ連携（送受信の自動タイムライン化）

- **何を**: Gmailの送受信メールを、宛先メールで顧客/担当者/商談に自動突合し、`activities`（`type='email'`）としてタイムライン表示。案件詳細に「誰といつ何をやりとりしたか」が自動で並ぶ。手入力の `type='email'` 活動を置換・補完。
- **どう**: Gmailスレッドを取り込み、`contacts.email` 完全一致 → 会社ドメイン一致の順で名寄せ。件名・抜粋・スレッドURL・方向（in/out）・日時を保存。本文全文は保存せず**メタデータ＋抜粋＋Gmailスレッドリンク**（プライバシー・容量配慮）。
- **データモデル（新規）**
```
email_messages
  id, tenant_id, provider('gmail'),
  gmail_thread_id, gmail_message_id,
  direction('in'|'out'),
  from_addr, to_addrs text[], subject, snippet,
  contact_id (nullable), account_id (nullable), opportunity_id (nullable),
  sent_at, linked_activity_id (nullable),   -- 生成した activities 行への参照
  created_at
```
- **同期方式の論点（要決定・§6）**: バックグラウンド受信には**ユーザー単位のGmail OAuth（Gmail API）**が要る。現接続の Gmail MCP は**対話認証前提でヘッドレス夜間バッチに不向き**（`SALES_AUTOMATION_DESIGN` §7.5 と同じ制約）。
  - **選択肢A（常時同期）**: 各ユーザーが Gmail OAuth 連携 → cron で増分同期（`historyId`）。価値最大だが OAuth 基盤の新設が必要。
  - **選択肢B（下書き中心・軽量）**: 受信同期は当面持たず、**送信下書き（F-101b）だけ記録**。まず送信側の可視化から。
- **実現性**: 選択肢Aは○（標準的だがOAuth基盤が前提）/ 選択肢Bは◎（既存MCPの範囲）。

### 4.2 F-101b シーケンス（追客カデンス）＋ 送信キュー

- **何を**: 「Day0お礼 → Day3資料 → Day7再打診」等の**多段フォロー**を定義。案件を投入（enroll）すると、日次cronが「今日送るべきステップ」を算出。**返信 or アポ確定 or 受注/失注で自動停止**。追客漏れを構造的に潰す＝**乗り換え障壁の本丸**。
- **送信方針（確定原則との整合）**: 完全自動送信はしない。**「送信キューに下書きを積む → 担当がワンクリックで送信」の半自動**。
  - 各ステップ到来時に Gmail `create_draft` で下書き生成し、`sequence_steps_queue` に「送信待ち」を積む → 担当がアプリ or Gmailで確認して送信 → 送信をトリガーに次ステップの待機開始。
- **データモデル（新規）**
```
email_sequences（定義）
  id, tenant_id, name, status('active'|'archived'),
  steps jsonb,   -- [{ order, wait_days, template_id, channel:'email' }...]
  stop_on jsonb, -- { on_reply:true, on_appointment:true, on_won:true, on_lost:true }
  created_by, created_at, updated_at

sequence_enrollments（案件ごとの進行状態）
  id, tenant_id, sequence_id,
  opportunity_id (nullable), contact_id,
  current_step int, status('active'|'stopped'|'completed'),
  next_step_due_date date, stopped_reason,
  created_at, updated_at

email_templates（文面テンプレ・共用）
  id, tenant_id, name, subject_tmpl, body_tmpl, solution_package_id(nullable),
  created_by, created_at, updated_at
```
- **停止検知**: F-101a のメールログ（in方向＝返信）／`opportunities.yomi='4.アポ'`化／won/lost を日次で突合し `sequence_enrollments.status='stopped'` に。
- **実現性**: ○（新規だが標準的）。送信は手動キューなので**誤送信リスクが構造的に無い**。

### 4.3 F-101c 開封/クリック・トラッキング

- **何を**: 送信メールの**開封（透明1×1ピクセル）**と**リンククリック**を検知。「提案書を3回開いた」を危険案件・ヨミ判定・営業の優先順位付けへ接続。
- **どう**: Next.js に公開エンドポイントを新設。
  - `GET /api/track/open/[token]` … 1×1 GIF を返しつつ `email_events(kind='open')` を記録。
  - `GET /api/track/click/[token]?u=<encoded>` … `email_events(kind='click')` を記録して 302 リダイレクト。
  - 送信時に本文へピクセルURL＋リンクラップを埋め込む（トークンは `email_messages.id` に紐づく不可逆ID）。
- **データモデル（新規）**
```
email_events
  id, tenant_id, email_message_id,
  kind('open'|'click'), url (nullable),
  ip_hash, user_agent, occurred_at, created_at
```
- **前提の論点（要決定・§6）**: 開封計測は**自前の送信経路にピクセルを注入できること**が前提。「Gmail下書き→人が手動送信」だと本文にピクセルを仕込めるが、Gmailのプロキシ画像キャッシュで開封精度が落ちる既知課題あり。**送信方式（下書き手動 vs 送信キュー）の確定が先行**（§6-2）。
- **実現性**: △（送信経路の確定が前提。技術的にはエンドポイント＋テーブルで標準実装可能）。

### 4.4 F-101 まとめ

| サブ機能 | 価値 | 実現性 | 前提 |
|---|---|---|---|
| a メールログ連携 | 高（やりとりが自動で残る） | ◎（選択肢B）/○（選択肢A=常時同期） | Gmail同期方式の決定 |
| b シーケンス | 最高（追客漏れ撲滅＝本丸） | ○ | 送信キュー（半自動）方針 |
| c 開封/クリック | 中〜高（ヨミ精度向上） | △ | 自前送信経路の確定 |

---

## 5. データモデル追加まとめ（新規テーブル）

すべて加算的（既存を壊さない）。共通で `tenant_id` ＋ RLS4点セット ＋ `set_updated_at`。

| テーブル | 役割 | 機能 |
|---|---|---|
| `automation_rules` | ルール定義（WHEN/IF/THEN） | F-102 |
| `automation_runs` | 発火監査ログ（冪等キー） | F-102 |
| `email_messages` | メール送受信のメタ＋名寄せ | F-101a |
| `email_events` | 開封/クリックイベント | F-101c |
| `email_sequences` | シーケンス定義 | F-101b |
| `sequence_enrollments` | 案件ごとの進行状態 | F-101b |
| `email_templates` | 文面テンプレ（F-102の`email_draft`と共用） | F-101b/F-102 |
| （既存拡張）`tasks.origin='automation'` | 自動起票タスクの区別 | F-102 |
| （既存活用）`batch_job_settings(job_kind='automation')` | 自動化ジョブの停止スイッチ | F-102 |
| （既存活用）`batch_runs(job_kind='automation')` | 実行運用ログ | F-102 |

---

## 6. 意思決定が必要な論点（次に決めたいこと）

1. **【決定済】F-102 発火方式＝バッチ（cron走査）**（2026-07-18）。残: ヨミ転落を日次で十分か、短間隔（15〜30分）へ格上げするか。
2. **F-101 メール送信方針**（トラッキング/シーケンスに影響）:
   - (推奨) **下書き→手動送信**（既定原則。誤送信ゼロ。開封計測は限定的）
   - **送信キュー→ワンクリック送信**（自前経路で開封/クリック計測が可能・半自動）
3. **F-101a Gmail同期**: 常時同期（ユーザーOAuth基盤を新設）か、当面は送信下書きのみ（選択肢B）か。
4. **Slackチャンネル振り分け**: MVP単一チャンネルで開始でよいか、初手から複数Webhook/Bot token化するか。
5. **F-102 UI**: MVPはレシピ方式（推奨）でよいか、初手からNo-codeビルダーを作るか。
6. **着手順**: 本書の推奨（F-102 → F-101a → F-101b → F-101c）でよいか。

---

## 7. 段階導入ロードマップ（案）

既存 WO に続けて **WO-18〜** として提案。上から着手推奨（既存資産の延長＝低リスク順）。

| WO | 名称 | 内容 | 前提 | 規模 |
|---|---|---|---|---|
| **WO-18** | ワークフロー自動化・基盤＋初期レシピ | F-102。`automation_rules/runs`＋`/api/cron/automation`＋レシピUI。**「ヨミC転落→Slack」を第一号**。Slackは単一チャンネル | なし（既存ログ活用） | 中 |
| **WO-19** | 自動化アクション拡張 | `create_task`/`app_notify`/`update_field`/`reassign` の網羅、発火履歴ビュー、短間隔cron格上げ | WO-18 | 小〜中 |
| **WO-20** | メールログ連携 | F-101a。Gmail送受信→`activities`自動記録（選択肢A/Bは§6-3で決定） | Gmail同期方式の決定 | 中〜大 |
| **WO-21** | メールテンプレ＋シーケンス | F-101b。`email_templates`/`email_sequences`/`sequence_enrollments`＋送信キュー（半自動） | WO-20 | 大 |
| **WO-22** | 開封/クリック・トラッキング | F-101c。`/api/track/*`＋`email_events`＋案件詳細への可視化 | 送信方式の確定（§6-2） | 中 |
| **WO-23** | 自動化×メール統合 | F-102の`email_draft`アクションでシーケンス投入・お礼下書きを自動化 | WO-18, WO-21 | 中 |

**最短で体感を出す入口**: **WO-18（ヨミ転落→Slack）**。既存 `yomi_change_logs` に載るだけで、営業会議前に「危険転落」が自動で流れる。続けてメール系（WO-20→21）で乗り換え障壁の本丸へ。

---

## 8. 実装の勘所（方針踏襲）

- **検知源は新設しない**。`yomi_change_logs`/`stage_histories`/`activities` の既存ログを走査。
- **アクションは既存出力口の部品化**（Slack送信ヘルパー・`notifications`insert・`tasks`起票を関数化して再利用）。
- **冪等性**（`automation_runs(rule_id, trigger_ref)` 一意制約）で cron 再実行に強く。
- **人の関所**: メール送信は手動（下書き/キュー）。自動化が勝手に外部送信しない。
- **停止スイッチ**: `batch_job_settings(job_kind='automation')` で一括OFF。事故時に即停止できる運用性。
- **監査**: `update_field`/`reassign` 等の更新系は既存の監査ログ方針（`audit_events`）に記録。
- **RLS/DB原則**: 全テーブル tenant_id＋RLS4点、cron系RPCは `SECURITY DEFINER`＋`search_path`固定＋CRON_SECRET認可。
- **ブランチ運用・機微情報の非コミット**は現行ルールを継続。

---

## 付録: F-101/F-102 と既存ギャップ分析の対応

| 本書 | `PRODUCT_GAP_ANALYSIS` | 備考 |
|---|---|---|
| F-101 メール連携 | F7 メール/カレンダー連携（○中期）／D-01 Gmail同期 | 本書で「ログ/シーケンス/トラッキング」に分解・具体化 |
| F-101c トラッキング | （新規） | 提案開封を危険案件・ヨミ判定に接続する提案 |
| F-102 ワークフロー自動化 | C-01 通知基盤の発展形／F13 Webhook（将来アクション） | 通知を「ルール駆動」へ一般化。既存 `yomi_change_logs` 活用が鍵 |
