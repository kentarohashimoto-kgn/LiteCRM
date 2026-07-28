# リード→アポ獲得プロセス ハイレベル化 詳細設計（2026-07）

> **目的**: リード獲得からアポ獲得（インサイドセールス業務）までを、手動の優先順位付け・個別の電話/メール追客から、
> **「学習する優先順位付けエンジン × メール×架電シナリオ × 反応スコアリング × 即アクション通知」** の仕組みへ引き上げる。
> **前提資料**: `docs/EMAIL_WORKFLOW_AUTOMATION_SPEC_2026-07.md`（F-101/F-102。**大半が実装済み**）/
> `docs/exec-plan/WO-06_lead-scoring-nurture.md`（ルールベーススコア。**実装済み**）/
> `docs/SALES_AUTOMATION_DESIGN_2026-07.md`（AI実行方針A・人の関所原則）/ `docs/CURRENT_SPEC_2026-07.md`（as-is）
> 作成日: 2026-07-28 / 対象ブランチ: `claude/lead-scoring-appointment-design-65a7w8`
> **本書はコード変更を含まない設計・意思決定文書**。合意後にワークオーダー（WO-24〜）へ分解して実装する。

---

## 0. 先に結論

1. **土台はすでに本番にある**。今回の要望5点のうち「メールの定型/自動送信」「開封・クリック計測」「返信検知」「ルールエンジン・通知」は
   マイグレーション 0142〜0147 で**実装済み**。本設計はゼロから作らず、**既存スタックにリード文脈と学習・架電・通知閾値を接続する**。
2. **優先順位付けは「Fit × Engagement の2軸」に拡張する**。現行 `rescore_leads`（属性5軸・S〜Dランク・内訳jsonb）は
   **Fit軸として温存**し、メール開封/クリック/返信/資料閲覧/架電結果から **Engagement軸（時間減衰つき）** を新設。
   2軸マトリクス（A1〜D4）で「今日誰に・なぜ・何をするか」を可視化する。**点数には必ず根拠（貢献要因リスト）を添える**。
3. **「徐々に学習する」は3段階で実現する**（L0 ルール → L1 実績からの重み自動チューニング＋人の承認 → L2 予測モデル）。
   最初から機械学習にせず、**成果ラベル（アポ獲得/商談化）を貯める設計を先に入れる**のが肝。
4. **シナリオ（カデンス）はメール専用の `email_sequences` を多チャネル化**し、`channel: email | call` のステップ列として
   「お礼メール→Day1架電→Day3アポ打診メール→Day5架電…」を定義可能にする。架電ステップはタスク（Todayキュー）として現れ、
   **通話結果は選択式コード**で5秒入力 → 次アクションが自動で決まる。
5. **メール送信方針のアップデート（要確認 → §10-1）**: 定型テンプレのシーケンス自動送信は既に稼働中（WO-21）。本要望の
   「順次自動送信」はこれを踏襲する。**AIによる個別カスタマイズメールのみ「下書き→人が承認」の関所を残す**（誤情報リスクがあるため）。
   自動送信には送信時間帯・日次上限・配信停止（サプレッション）のガードレールを必須で付ける。
6. **閾値通知は既存ルールエンジン（F-102）のトリガー追加＋短間隔cron**で実現。「スコア閾値超え」「開封直後」を検知し、
   担当IS/FSへアプリ内＋Slack/Google Chat通知 →「今すぐ対応」キューに積む。**開封して5分以内に架電**できる状態を作る。

---

## 1. スコープと to-be 業務フロー

対象は「リード生情報の登録 → アポ獲得 → FS引継ぎ」。商談以降（FS領域）は既存機能・既存WOの範囲。

```
[リード獲得] 展示会/セミナー/HPフォーム/資料請求/CSV取込（既存）
     │  登録・取込と同時に…
     ▼
[① 優先順位付けエンジン]  Fit(属性) × Engagement(行動) = 優先グレード + 理由 + SLA期限   ← F-201
     │  グレード別の推奨アクション
     ▼
[② アプローチシナリオ投入]  お礼メール/架電/アポ打診の混合カデンス（テンプレ or AIカスタム） ← F-202/F-203
     │  メールは自動送信・架電はTodayキューにタスク化
     ▼
[③ 反応トラッキング]  開封・URLクリック・資料閲覧・返信・通話結果 → Engagementスコア加点    ← F-204
     │  閾値超え/開封直後
     ▼
[④ ホット通知 → 即アクション]  IS/FSへ通知 →「今すぐ対応」キュー → ワンクリック架電ログ      ← F-205
     │  アポ獲得
     ▼
[⑤ アポ登録 → FS引継ぎ]  商談化（既存）＋ 引継ぎコンテキスト自動生成                        ← F-206
     │  結果（アポ可否・商談化・受注）が…
     └──────→ [学習ループ] スコア重みの自動チューニングへフィードバック（F-201 L1）
```

---

## 2. 前提：接続できる既存資産（実査 2026-07-28）

前回設計書（F-101/F-102）以降に**実装まで完了しているもの**。本設計はこれらの再利用を前提とする。

| 資産 | 実体（migration / コード） | 本設計での用途 |
|---|---|---|
| リードスコアリング | `rescore_leads` RPC（`0048`/`0050`）。5軸（規模/役職/課題/時期/予算）0-100、S〜Dランク、`lead_score_detail` jsonb、手動rank保護 | **Fit軸としてそのまま採用**（F-201） |
| メールテンプレ/送信 | `email_templates` / `email_messages`（`0143`）、SMTP/Google OAuth送信・開封ピクセル・リンクラップ（`0144`, `/api/track/o`,`/api/track/c`, `deliverTrackedEmail`） | F-203送信コア・F-204イベント源 |
| メールシーケンス | `email_sequences` / `sequence_enrollments` + 日次cron `/api/cron/sequences`（`0145`）。**テンプレの自動送信が既に稼働** | F-202の母体（多チャネル化して拡張） |
| 受信同期（返信検知） | IMAP増分取込 `/api/cron/inbound-sync`（`0146`）、`smtp_message_id`/`in_reply_to` 突合 | 返信＝最強のEngagementシグナル・シナリオ自動停止 |
| ルールエンジン | `automation_rules` / `automation_runs` + `/api/cron/automation`（`0142`）。トリガー7種・アクション（Slack/アプリ内通知/タスク） | F-205の実行基盤（トリガー追加のみ） |
| 通知 | `notifications`（`0071`）/ Slack Webhook / Google Chat連携（`0162`） | F-205の出力口 |
| ISロール・ホーム | インサイドセールスロール＋マイページ（`0170`）、`/app/today`（今日のアポ/AC）、`/app/appointments` | ワークキューの実装先 |
| 接点集計 | `touchpoints` / `person_engagement`（`0013`）、セミナー/展示会接点 | Engagement軸のオフライン接点源 |
| リード取込 | `/app/leads/import`、HPフォーム/資料請求ソース（`0159`/`0160`/`0161`） | 生情報登録の入口（登録時に自動スコア） |
| バッチ運用 | `batch_runs` / `batch_job_settings`（停止スイッチ）、CRON_SECRET認可 + service role | 全新規cronの運用型 |

**DB/RLS原則（踏襲）**: 新規テーブルは全て `tenant_id` + RLS4点セット + `set_updated_at`。cron系RPCは
`SECURITY DEFINER` + 明示テナント + `search_path=public,pg_temp` + CRON/authenticated限定。加算的スキーマ（既存を壊さない）。

---

# F-201 優先順位付けエンジン v2（学習型・理由可視化）

## 3.1 スコアモデル — Fit × Engagement の2軸

1つの数値に混ぜると「大企業だが無反応」と「小規模だが今すぐ客」が同点になり現場が信用しなくなる。**2軸を分離**する。

- **Fit（適合度・0-100）**: 既存 `rescore_leads` の5軸（規模20/役職20/課題25/時期15/予算20）を**そのまま使う**。変更なし。
- **Engagement（行動熱量・0-100）**: 新設。行動イベントの加点合計に**時間減衰**を掛けて0-100に正規化。

### Engagementイベントと初期点数（`engagement_scoring_rules` でテナント別に変更可能）

| kind | 検知源（既存） | 初期点数 | 日次上限 |
|---|---|---|---|
| `email_open` | `email_events(kind='open')` | +3 | 同一メール1日1回まで |
| `email_click` | `email_events(kind='click')` | +8 | +8×3回まで/日 |
| `doc_view` | 資料リンクのクリック（`email_links` に `is_document` フラグ追加。§6.2） | +12 | — |
| `email_reply` | `email_messages(direction='in', in_reply_to照合)` | +25 | — |
| `form_resubmit` | 既存リードの再問い合わせ/資料請求（`0159`/`0160` 経路で既存リードに名寄せ一致） | +20 | — |
| `seminar_attend` | `touchpoints`（セミナー/展示会） | +10 | — |
| `call_connected` | 通話結果コード `connected_*`（F-202） | +10 | — |
| `call_positive` | 通話結果コード `connected_positive` / `callback_requested` | +15 | — |
| `unsubscribe` / `bounce` | サプレッション（§5.3） | **Engagement=0に強制** | — |

### 時間減衰（ディケイ）

ホットさは腐る。集計時に **半減期14日** の指数減衰を掛ける:

```
engagement_raw = Σ ( points(event) × 0.5 ^ (経過日数 / 14) )
engagement_score = min(100, round(engagement_raw))
```

減衰は**イベントを消さず集計時に計算**（`rollup_lead_engagement()` RPC・夜間+短間隔cronから呼ぶ）。
これによりスコア上位が古いリードで埋まる問題を構造的に防ぐ。

## 3.2 優先グレード（2軸マトリクス）と推奨アクション

| | **Engagement 高（50+）** | **中（20-49）** | **低（<20）** |
|---|---|---|---|
| **Fit S/A（65+）** | **P1: 今すぐ架電**（当日SLA） | **P2: シナリオ強化**（架電比率高） | **P3: ナーチャリング**（メール中心） |
| **Fit B（50-64）** | **P2: 今週中に接触** | P3: 標準シナリオ | P4: 低頻度メール |
| **Fit C/D（<50）** | **P3: メールで反応確認**（低コスト） | P4 | P5: 対象外候補（四半期見直し） |

- `leads.priority_grade`（'P1'〜'P5'）として保存。一覧・Todayキューのソートキー。
- グレードごとに**推奨アクション文**（上表）を表示。閾値・アクション文は `lead_grade_defs`（シード付き）で変更可能。

## 3.3 理由の可視化（スコアの説明責任）

点数だけ出しても現場は納得せず手動に戻る。**リード詳細・キューカードの両方に貢献要因を表示**する:

- **Fit内訳**: 既存 `lead_score_detail`（size/role/issue/timing/fit）をラベル化して表示（例「従業員1,200名 +20 / 役員 +20 / 導入時期1-3ヶ月 +15」）。
- **Engagement内訳**: 直近イベント上位5件を減衰後点数つきで表示（例「7/26 価格ページクリック +7.2 / 7/25 資料閲覧 +11.4 / 7/20 開封 +2.2」）。
- **グレードの根拠**: 「Fit A × Engagement 62 → **P1: 本日中に架電**」を1行で。
- 実装: `lead_score_detail` に `engagement: {score, top_events[]}` を追記する形（既存jsonbの加算拡張）。

## 3.4 学習ループ — 「徐々に判定が高レベルになる」の実現（3段階）

| 段階 | 仕組み | 前提 | 人の関所 |
|---|---|---|---|
| **L0（現行+今回）** | ルールベース（Fit軸=実装済 / Engagement軸=本設計） | なし | ルール・点数はUIで編集可能 |
| **L1（実績チューニング）** | 月次バッチが**成果ラベルつき履歴**から軸/イベント別の成果率を集計し、**重み改定案を draft で提示** →人が承認したら新バージョン適用・全件再スコア | ラベル蓄積 3ヶ月〜 / 成約・アポの母数 | **承認必須**（自動適用しない） |
| **L2（予測モデル）** | ロジスティック回帰等でアポ確度そのものを予測（0-100%）。理由=係数上位の要因表示 | L1が安定し母数が十分（目安: アポ結果500件+） | 併記表示から開始（ルール点数と並べて信頼を検証） |

**設計の肝は「ラベルを今日から貯める」こと**:

- `leads` に成果ラベルを明示化: `outcome`（'appointment'|'converted'|'lost'|'disqualified'）と `outcome_at`。
  アポ登録・商談化ボタン・失注/対象外処理の既存フローから自動セット。
- スコアのスナップショット: **成果確定時点のスコア・グレード・重みバージョン**を `lead_score_history` に保存
  （「当時この点だったリードがアポになった」を後から再現できないと学習できない）。
- 重みは `scoring_weight_sets`（バージョン管理・status: draft/active/archived）。L1バッチは
  SALES_AUTOMATION §7 の**方針A（Claude Code夜間バッチ・従量ゼロ）**で集計・改定案生成し、draftで書き戻す。

## 3.5 SLA（スピード・トゥ・リード）

- 既存 `first_contact_due_date`（S=+1日/A=+3営業日/B=+7日）を**グレード連動に更新**: P1=当日 / P2=+2営業日 / P3=+7日。
- 経過時間の可視化: リード一覧・Todayキューに「登録からの経過」「期限超過（赤）」。
- 超過検知は既存ルールエンジンのトリガー `lead_sla_overdue`（新設・§7.1）→ 担当催促・2日超過で管理者Cc。

## 3.6 DB変更（migration 0172 想定）

```sql
alter table public.leads
  add column if not exists engagement_score integer not null default 0,
  add column if not exists priority_grade text,          -- 'P1'..'P5'
  add column if not exists last_engaged_at timestamptz,
  add column if not exists hot_since timestamptz,        -- P1到達時刻（通知の冪等キーにも使用）
  add column if not exists outcome text,                 -- 'appointment'|'converted'|'lost'|'disqualified'
  add column if not exists outcome_at timestamptz;

create table public.lead_engagement_events (   -- 全反応イベントの統合ログ（email_events等から正規化して転記）
  id, tenant_id, lead_id, contact_id(nullable),
  kind text,                 -- §3.1の表
  points numeric,            -- 発生時点の素点（ルール改定に影響されない）
  ref_table text, ref_id uuid,   -- 冪等キー: unique(tenant_id, ref_table, ref_id, kind)
  occurred_at timestamptz, created_at
);

create table public.engagement_scoring_rules ( -- kind→点数・日次上限（シード=§3.1初期値）
  id, tenant_id, kind, points numeric, daily_cap int, is_active bool, ...
);

create table public.lead_grade_defs (          -- マトリクス閾値・推奨アクション文（シード=§3.2）
  id, tenant_id, grade, fit_min, fit_max, eng_min, eng_max, action_label, sla_days, ...
);

create table public.scoring_weight_sets (      -- L1学習の重みバージョン
  id, tenant_id, version int, kind('fit'|'engagement'), weights jsonb,
  status('draft'|'active'|'archived'), rationale text,  -- 改定案の根拠（成果率集計）
  created_by('batch'|'user'), approved_by, ...
);

create table public.lead_score_history (       -- 学習用スナップショット
  id, tenant_id, lead_id, fit_score, engagement_score, priority_grade,
  weight_set_version int, snapshot_reason('outcome'|'weekly'), created_at
);
```

RPC: `rollup_lead_engagement(p_lead_id uuid default null)` — イベント→減衰集計→ `leads.engagement_score`/`priority_grade` 更新。
実行: ①イベント転記cron（§6.3）直後 ②夜間全件 ③リード詳細の再計算ボタン。

---

# F-202 アプローチシナリオ（メール×架電の混合カデンス）

## 4.1 シナリオモデル — `email_sequences` の多チャネル化

新テーブルを作らず、**既存 `email_sequences` を拡張**する（cron・停止判定・enrollment資産を再利用）:

```sql
-- migration 0173 想定
alter table public.email_sequences
  add column if not exists kind text not null default 'email',   -- 'email'(既存互換) | 'approach'(多チャネル)
  add column if not exists target text not null default 'opportunity';  -- 'opportunity' | 'lead'
alter table public.sequence_enrollments
  add column if not exists lead_id uuid references leads(id) on delete cascade;
```

**steps jsonb のスキーマ拡張**（既存: `{order, wait_days, template_id}`）:

```jsonc
[
  { "order": 1, "offset_days": 0, "channel": "email", "purpose": "thanks",
    "mail_mode": "template", "template_id": "..." },                       // Day0 お礼メール（即日自動送信）
  { "order": 2, "offset_days": 1, "channel": "call",  "purpose": "first_touch",
    "call_script_id": "...", "due_slot": "am" },                           // Day1 架電（タスク化）
  { "order": 3, "offset_days": 3, "channel": "email", "purpose": "apo",
    "mail_mode": "ai_custom", "template_id": "fallback-..." },             // Day3 アポ打診（AIカスタム→承認→送信）
  { "order": 4, "offset_days": 5, "channel": "call",  "purpose": "apo" },  // Day5 アポ打診架電
  { "order": 5, "offset_days": 8, "channel": "email", "purpose": "apo",
    "mail_mode": "template", "template_id": "..." }                        // Day8 最終打診→クローズ
]
```

- `channel:'email'` … 既存 `/api/cron/sequences` がそのまま送信（`mail_mode` は §5 参照）。
- `channel:'call'` … cronが**タスクを自動起票**（`tasks.origin='scenario'`、期日=到来日、リード/コールスクリプトへのリンク付き）。
  タスク完了=通話結果コード入力（§4.3）で次ステップの待機が開始。**未消化のままでもメールステップは先に進む**
  （設定 `call_blocking: false` 既定。カデンスが電話待ちで止まらないように）。

## 4.2 シナリオのプリセット（シード）

グレード連動の初期シナリオを同梱し、ゼロ設定で使い始められるようにする:

| プリセット | 対象 | 構成 |
|---|---|---|
| **P1 即アタック** | P1（高Fit×高Eng） | Day0お礼メール → Day0架電 → Day1架電 → Day2アポ打診(AIカスタム) → Day4架電 → Day7最終打診 |
| **P2 標準** | P2 | 上記 §4.1 の5ステップ（お礼→架電→アポ打診→架電→最終打診） |
| **P3 ナーチャリング** | P3 | Day0お礼 → Day7事例紹介 → Day21セミナー案内 → Day45再打診（全てテンプレメール） |
| **掘り起こし** | 停滞リード | 再訪検知後に投入。Day0「その後いかがですか」(AIカスタム) → Day2架電 |

- 投入（enroll）は ①リード詳細から手動 ②一覧から一括 ③**ルールエンジンのアクション `enroll_scenario`（新設）**で
  「P1到達→即アタック自動投入」等を自動化。宛先は `leads.contact_id → contacts.email`（無ければ投入不可でエラー表示）。
- **停止条件（既存 `stop_on` を拡張）**: 返信検知 / アポ登録（`outcome='appointment'`） / 商談化 / 配信停止 /
  通話結果 `connected_positive`（人の追客に切替） / 手動停止。停止理由は enrollment に記録し、離脱分析（§8.4）に使う。

## 4.3 架電の型化 — ワンクリックログ＋通話結果コード

「個別に電話」の暗黙知をデータにする。自由記述をやめ、**選択式5秒入力**にする:

```sql
create table public.call_logs (   -- migration 0173
  id, tenant_id, lead_id(nullable), opportunity_id(nullable), contact_id(nullable),
  called_by uuid, called_at timestamptz,
  result text not null,   -- 'no_answer'|'gatekeeper'|'connected_negative'|'connected_positive'|'callback_requested'|'wrong_number'
  callback_at timestamptz,          -- 再架電依頼の日時
  memo text,                        -- 任意1行
  scenario_enrollment_id(nullable), scenario_step int,
  created_at
);
```

- **結果コード→次アクション自動セット**: `no_answer`→翌営業日再架電タスク（3回不在でメール切替提案）/
  `callback_requested`→指定日時にタスク＋カレンダー登録 / `connected_positive`→アポ打診 or アポ登録へ誘導 /
  `connected_negative`→シナリオ停止＋ナーチャリングへ降格提案 / `wrong_number`→リード情報修正を促す。
- `call_connected`/`call_positive` は Engagementイベントへ転記（§3.1）。`activities(type='call')` にも自動記録し
  タイムラインを一本化。
- コールスクリプト: `call_scripts(id, tenant_id, name, purpose, body, talk_points jsonb)`。シナリオのcallステップから参照。
  将来 `sales_playbooks`（B1・業種×役職の型）と接続。
- 発信自体は当面 **tel: リンク（スマホ/社用携帯）** とし、CTI連携（Zoom Phone/MiiTel等）は将来論点（§10-6）。

## 4.4 ワークキュー — 「今日やること」1枚に集約

担当ISにリード一覧を見せない。`/app/today` を拡張し（ISロールには初期表示）、上から処理するだけの単一リストにする:

1. **🔥 今すぐ対応**（F-205のホット通知起点。開封直後・閾値超え・再架電時刻到来）
2. **📞 今日の架電**（シナリオ由来タスク＋再架電。優先グレード順）
3. **✉️ 承認待ちメール**（AIカスタム下書き。ワンクリック承認→送信キューへ）
4. **⏰ SLA期限**（本日期限の初回接触・超過は赤）
5. 既存の「今日のアポ・次回AC」（現行機能）

各カードに: 会社/氏名/グレード/**理由（貢献要因1行）**/ 直近の反応 / tel:発信 / 通話結果ボタン / メール作成 / アポ登録。

---

# F-203 メール作成・自動送信（定型 / 個別カスタマイズ）

## 5.1 送信モード（ステップ単位で選択）

| mail_mode | 動作 | 関所 |
|---|---|---|
| `template` | 既存どおり。変数差し込み（`{company}` `{name}` 等）で **cronが自動送信** | なし（シナリオ有効化時に文面確定済みのため） |
| `ai_custom` | 夜間バッチ（方針A）がリード文脈から**個別文面を下書き生成** → Todayキュー「承認待ちメール」へ → **担当が承認したら次回cronで自動送信**（修正・却下も可） | **承認必須** |
| `manual` | 送信せずタスク化のみ（完全に人が書くステップ用） | 人が作成・送信 |

- AIカスタムの生成材料: リード属性（業種/規模/役職/流入元/needs）＋ 反応履歴（何を開き何をクリックしたか）＋
  接点（セミナー名・展示会名）＋ `solution_packages`/`sales_playbooks` の訴求。**「Day3のアポ打診なのに初回の挨拶文」に
  ならないよう、シナリオ上の位置（purpose）をプロンプトに含める**。
- 生成は `generated_by('claude_code'|'api')` を持つ下書きとして `email_messages(status='draft')` に保存
  （SALES_AUTOMATION §7.3 のA↔B切替設計と整合。即時性が必要になったら方針Bへ機能単位で昇格）。
- 承認期限までに未承認の場合の既定動作: **フォールバックのテンプレで送信**（`template_id` をfallbackとして必須指定）or
  スキップ。シナリオ設定で選択（既定=フォールバック送信。カデンスを止めないため）。

## 5.2 送信ポリシー（原則のアップデート）

`SALES_AUTOMATION_DESIGN` の「メール送信は手動」原則は、**リード追客の定型シーケンスについては既にWO-21で
自動送信に更新済み**。本設計はこれを正式化する:

> **定型（人が事前に確定した文面）は自動送信してよい。AIがその場で書いた文面は人の承認を通す。**

## 5.3 自動送信ガードレール（必須・migration 0174）

| ガード | 内容 |
|---|---|
| 送信時間帯 | 平日 8:00–18:00 JST のみ（cron側で制御。テナント設定で変更可） |
| 頻度上限 | 同一リード宛 1通/日・シナリオ間の二重投入禁止（同一リード×activeシナリオは1つ。unique制約） |
| サプレッション | `mail_suppressions(tenant_id, email, reason('unsubscribe'|'bounce'|'manual'), created_at)`。送信cronは必ず突合し、該当宛先はスキップ＋enrollment停止 |
| 配信停止導線 | 全自動送信メールのフッターに配信停止リンク `GET /api/track/u/[token]` → ワンクリックでsuppression登録（**特定電子メール法対応**: 送信者表示・オプトアウト手段の明記） |
| バウンス処理 | 送信失敗（5xx）を `email_messages.error_text` から検知し suppression（reason='bounce'）へ |
| 一括停止 | 既存 `batch_job_settings(job_kind='email_sequences')` を踏襲（事故時に即OFF） |

---

# F-204 反応トラッキング & エンゲージメントスコアリング

## 6.1 実装済み（再掲・変更なし）

- 開封: 透明ピクセル `/api/track/o/[token]` → `email_events(kind='open')`・`open_count`/`last_opened_at`。
- URLクリック: リンクラップ `/api/track/c` → `email_events(kind='click')`・`email_links` でURL別集計。
- 返信: IMAP受信同期の `in_reply_to` 照合（`0146`）。
- 画面: `/app/email/analytics`・`/app/email/history` で開封/クリックの実績表示。

## 6.2 追加①: 資料閲覧（doc_view）の検知

段階導入とする（§10-3）:

- **Phase 1（本設計スコープ）**: `email_links` に `is_document boolean` を追加。資料URL（Drive/Storageの提案書・
  サービス資料）へのクリックを `doc_view` として重み付け（クリック+8ではなく+12）。実装は列追加＋転記ルールのみで軽い。
- **Phase 2（将来）**: 自前ビューアページ `/d/[token]`（既存 `documents_storage 0166` の資産を配信）で
  **閲覧時間・ページ到達率**まで計測（「価格ページを3回見た」の解像度）。転送検知（社内共有＝決裁プロセスのシグナル）も拾える。

## 6.3 追加②: イベント→スコアへの転記パイプライン

```
email_events / email_messages(in) / call_logs / touchpoints / フォーム再問い合わせ
        │  15分間隔 cron /api/cron/engagement（増分・冪等: unique(ref_table, ref_id, kind)）
        ▼
lead_engagement_events（素点つき統合ログ）── lead_id への名寄せ: enrollment直結 → contact_id → メールアドレス一致
        │  同cron内で対象リードのみ rollup_lead_engagement()
        ▼
leads.engagement_score / priority_grade / last_engaged_at 更新
        │  P1昇格・閾値超えを検出
        ▼
F-205 通知へ（automation_rules 評価）
```

- 名寄せできないイベント（既知リードに紐づかない開封等）は保留テーブルに置かず**破棄**（ノイズ排除・シンプル優先）。
- `email_events` 側の既知課題（Gmail画像プロキシによる開封の過小/過大計測）は点数を低め（+3）に設定して吸収。
  **クリック・返信・通話を重く**するのが精度の要。

---

# F-205 ホットリード通知・即アクション

## 7.1 トリガー（既存ルールエンジンへの追加）

`automation_rules.trigger_type` に3種を追加（評価は `/api/cron/engagement` 15分間隔内で実施）:

| trigger_type | 発火条件 | condition_json 例 | 冪等キー |
|---|---|---|---|
| `engagement_threshold` | Engagementスコアが閾値を**下から上に**超えた | `{ "score_gte": 50, "grade_in": ["P1","P2"] }` | `leads.hot_since`（超過中の再通知は24h抑制） |
| `email_engaged` | 特定反応の直後（開封/クリック/資料閲覧） | `{ "kinds": ["click","doc_view"], "within_minutes": 15 }` | `lead_engagement_events.id` |
| `lead_sla_overdue` | 初回接触期限の超過 | `{ "overdue_days_gte": 0, "escalate_days": 2 }` | ルール×リード×日付 |

## 7.2 アクション（既存＋追加）

- 既存: `app_notify`（担当へベル通知・リード詳細への深リンク）/ `slack_notify` / `create_task`。
- 追加: `chat_dm`（Google Chat連携 `0162` を使った担当個人宛DM）/ `enroll_scenario`（§4.2）。
- **通知文面に必ず理由を含める**: 「⚡ {company} {name} が 5分前に提案資料を閲覧（Eng 62 / P1）。今すぐ架電を → [発信] [リードを開く]」。
- 通知ルーティング: リード担当（IS）→ 未対応30分で **チーム共有チャンネル**（早い者勝ち）→ SLA超過で管理者。
  担当不在時に誰も動けない状態を防ぐ。

## 7.3 「即アクション」の受け皿

通知を踏んだ先が一覧ページだと動線が切れる。**通知 → リード詳細のアクションバー（tel:発信 / 通話結果 / メール / アポ登録）**、
および Todayキュー「🔥 今すぐ対応」セクション（§4.4）に同カードを常設。**開封から架電までを2タップ**にする。

## 7.4 初期レシピ（シード）

1. **P1昇格 → 担当ISへChat DM＋アプリ内通知**（engagement_threshold, score_gte=50, grade_in=[P1]）
2. **資料閲覧15分以内 → 担当へ「今すぐ架電」通知**（email_engaged, kinds=[doc_view]）
3. **SLA超過 → 担当催促、2日超過で管理者Cc**（lead_sla_overdue）
4. **P1到達 → 即アタックシナリオ自動投入**（engagement_threshold + enroll_scenario）※運用に慣れてからONを推奨

---

# F-206 周辺機能（要望外だが必要と判断するもの）

## 8.1 重複検知・名寄せ（二重アプローチ防止）

- リード登録/取込時に **会社名正規化（company_norm・既存の商談化ボタンと同ロジック）＋メールドメイン＋氏名** で
  既存リード/顧客/進行中シナリオとの重複を検知し、警告表示（「同一企業の別担当者に架電中: 佐藤（担当: 田中）」）。
- 二重架電はブランド毀損に直結するため、**シナリオ投入時にも同一企業のactive enrollmentをチェック**して確認を挟む。

## 8.2 リード自動割当

- ルールエンジンの既存トリガー `lead_created` にアクション `assign_owner` を追加: 条件（流入元/地域/規模）→
  指定IS or ラウンドロビン。手動配布の待ち時間（=SLAの主要な敵）を消す。

## 8.3 アポ獲得 → FS引継ぎ

- アポ登録時（既存 `/app/appointments/new` / 商談化ボタン）に **引継ぎサマリーを自動生成**:
  リード属性・スコアと理由・シナリオ実施履歴・全反応タイムライン・通話メモを1枚に（AI要約は方針Aの夜間 or 即時ボタン）。
- `outcome='appointment'` / `outcome_at` を自動セット（学習ラベル §3.4）。シナリオは自動停止。
- FS側の商談詳細に「リード期の文脈」パネルを表示（なぜホットだったかをFSが知って初回商談に臨める）。

## 8.4 IS KPIダッシュボード（`/app/leads` 配下 or mypage）

| 指標 | 源 |
|---|---|
| グレード別リード数・滞留 | leads |
| SLA遵守率（初回接触までの中央値） | first_contacted_at − acquired_at |
| 架電数・接続率・担当接触率 | call_logs（結果コード別） |
| メール開封率・クリック率・返信率（テンプレ別/シナリオ別） | email_messages/email_events |
| **シナリオ別アポ獲得率・ステップ別離脱** | sequence_enrollments（stopped_reason別） |
| アポ獲得数・リード→アポ転換率（グレード別） | outcome |

- グレード別転換率は**スコアの妥当性検証**そのもの（P1の転換率がP3と変わらなければ重みが間違っている）。
  L1学習（§3.4）の判断材料としてこの画面を使う。

## 8.5 曜日×時間帯の接続率ヒートマップ（将来・データが貯まってから）

`call_logs` が貯まれば「この業種は火曜10時が繋がる」を提示可能。実装は集計RPC＋ヒートマップ表示のみ。L1学習と同時期。

---

## 9. データモデル追加まとめ（migration 0172〜0174）

すべて加算的。共通で `tenant_id` + RLS4点セット + `set_updated_at`。

| migration | テーブル/変更 | 機能 |
|---|---|---|
| **0172** | `leads` 拡張（engagement_score/priority_grade/last_engaged_at/hot_since/outcome/outcome_at） | F-201 |
| 0172 | `lead_engagement_events` / `engagement_scoring_rules` / `lead_grade_defs`（シード付） | F-201/F-204 |
| 0172 | `scoring_weight_sets` / `lead_score_history` | F-201 L1学習 |
| 0172 | RPC `rollup_lead_engagement()` | F-201 |
| **0173** | `email_sequences.kind/target` + steps拡張 / `sequence_enrollments.lead_id` | F-202 |
| 0173 | `call_logs` / `call_scripts`、`tasks.origin='scenario'` | F-202 |
| 0173 | シナリオプリセット・シード（P1即アタック/P2標準/P3ナーチャリング/掘り起こし） | F-202 |
| **0174** | `mail_suppressions` + 配信停止エンドポイント用トークン / `email_links.is_document` | F-203/F-204 |
| 0174 | `automation_rules` トリガー3種＋アクション（`chat_dm`/`enroll_scenario`/`assign_owner`）の定義追加 | F-205/F-206 |

新規cron: `/api/cron/engagement`（15分間隔: イベント転記→rollup→トリガー評価）。
既存cron変更: `/api/cron/sequences`（callステップのタスク起票・ai_customの承認済み送信・suppression突合・時間帯ガード）。

---

## 10. 意思決定が必要な論点

1. **自動送信の正式化（§5.2）**: 「定型は自動送信・AIカスタムは承認制」の原則更新で確定してよいか。
   （要望の「順次自動送信」と既存WO-21の実装は既にこの方向。明文化のみ）
2. **AIカスタムメールの実行方式**: 方針A（夜間・従量ゼロ・翌朝承認）で開始し、即時性が必要になったら方針Bへ昇格、でよいか。
   ※方針Aは SALES_AUTOMATION §7.5 のフォールバック（F1: batch ingest API）の実装が前提。
3. **資料閲覧の深度（§6.2）**: Phase 1（トラッキングリンク）で開始し、Phase 2（自前ビューア・閲覧時間計測）は
   効果を見て判断、でよいか。
4. **通知チャネルの優先**: Google Chat DM / Slack / アプリ内の使い分け（現場の常用ツールに合わせる。推奨: Chat DM＋アプリ内）。
5. **学習ラベルの定義（§3.4）**: L1の「成果」を**アポ獲得**とするか商談化とするか（推奨: 主=アポ獲得〔母数が多く早い〕、
   副=商談化・受注〔重み付け検証用〕）。
6. **CTI連携**: 当面 tel: リンク＋手動結果入力で開始し、MiiTel/Zoom Phone等の連携（自動録音・自動ログ）は
   架電量が増えた段階で検討、でよいか。
7. **P1自動シナリオ投入（§7.4-4）**: 初期はOFF（手動投入で運用に慣れる）→ 1ヶ月後にON、の段階導入でよいか。

---

## 11. 段階導入ロードマップ（WO-24〜29）

既存WO（〜23）に続けて提案。上から着手推奨。**先にデータが貯まる基盤（イベント・ラベル・通話ログ）を入れ、学習は最後**。

| WO | 名称 | 内容 | 前提 | 規模 |
|---|---|---|---|---|
| **WO-24** | エンゲージメント基盤＋2軸グレード | 0172一式・`/api/cron/engagement`・rollup・リード詳細/一覧の理由表示・SLA更新 | なし（既存email_events活用） | 中 |
| **WO-25** | ホット通知・即アクション | トリガー3種・通知ルーティング・Todayキュー「🔥今すぐ対応」・初期レシピ | WO-24 | 小〜中 |
| **WO-26** | アプローチシナリオ（メール×架電） | 0173一式・シーケンス多チャネル化・callタスク・通話結果コード・プリセット・Todayキュー架電セクション | WO-24 | 中〜大 |
| **WO-27** | 送信ガードレール＋AIカスタムメール | 0174・suppression/配信停止/時間帯・ai_custom生成（方針A）＋承認キュー | WO-26・§10-2の決定 | 中 |
| **WO-28** | FS引継ぎ＋IS KPIダッシュボード | 引継ぎサマリー・outcomeラベル自動化・KPI画面（グレード別転換率含む） | WO-24〜26 | 中 |
| **WO-29** | 学習ループ L1 | 成果率集計バッチ（方針A）→重み改定案draft→承認UI→再スコア。接続率ヒートマップ | WO-28 + ラベル蓄積3ヶ月 | 中 |

**最短で体感を出す入口**: WO-24→25。既に流れている開封/クリックイベントをスコア化して通知するだけで、
「メールを見た瞬間に電話が来る」体験が実現する。シナリオ（WO-26）で追客の抜け漏れをゼロにし、
学習（WO-29）は**ラベルが貯まってから**——ここを焦らないのが、優先順位付けエンジンが現場に信用される条件。

---

## 付録: 要望→設計の対応表

| 要望 | 対応機能 | 状態 |
|---|---|---|
| 生情報登録→優先順位付けエンジン（学習・理由可視化） | F-201（Fit実装済＋Engagement新設＋L1/L2学習） | Fit軸=実装済 / 他=本設計 |
| お礼メール・架電・アポ打診の混合シナリオ | F-202（シーケンス多チャネル化＋プリセット） | メール部分=実装済 / 架電混合=本設計 |
| 個別カスタム/定型メールの選択・順次自動送信 | F-203（mail_mode 3種＋承認キュー） | 定型自動送信=実装済 / カスタム=本設計 |
| 開封・資料確認・URLクリックの把握とスコアリング | F-204（計測=実装済＋doc_view＋スコア転記） | 計測=実装済 / スコア化=本設計 |
| 閾値超えでIS/FSへ通知・即アクション | F-205（トリガー追加＋Todayキュー） | ルール基盤=実装済 / 閾値・キュー=本設計 |
| （追加提案） | F-206: 重複検知/自動割当/FS引継ぎ/KPI/接続率分析 | 本設計 |
