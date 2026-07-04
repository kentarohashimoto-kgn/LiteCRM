# WO-05: 新規商談ワークフロー（分類・本部承認・分類別フォロー）

> 前提: WO-00〜03完了（WO-04と並行可）。要件書4.8 / 5.3 / 10.2 / 10.3 対応。
> **目的**: 初回商談後の「進め方の分類」を必須化し、本部が承認・指導。分類に応じたフォロータスクを自動生成し自然消滅を防ぐ。

## DB変更（migration 0048）

### sales_schedules 新設（要件書4.8）
```sql
create table public.sales_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  schedule_type text not null,     -- A_short_term/B_subsidy_budget/C_multi_stakeholder/D_long_term/E_nurturing
  reason text not null,
  proposed_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approval_status text not null default 'pending',  -- pending/approved/rejected/needs_revision
  approval_comment text,
  next_actions_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```
（RLS4点＋トリガー。1案件に最新1件が有効: unique制約は付けず、最新レコードを有効とする）

### テンプレマスタ（要件書10.2業種別 / 10.3職種別）
```sql
create table public.sales_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  template_type text not null,     -- 'industry' | 'role'
  key_name text not null,          -- 製造業/建設業/... 社長/情シス/...
  pitch text not null,             -- 初期訴求・刺さる切り口
  hearing_points text,             -- ヒアリング項目
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```
シード: 要件書10.2の8業種＋10.3の6職種をそのままINSERT。

### tenant_settings に `enforce_hq_approval boolean default false` を追加（D11）。

## 実装詳細

### 1. 分類の登録（営業側）
- 案件詳細に「スケジュール分類」セクション（WO-01で場所は確保済みの構成に追加）。
- 初回商談実施後（first_meeting_date あり）で分類未登録の案件には、詳細画面と一覧に**黄色バッジ「分類未登録」**を表示。
- 登録フォーム: 分類（5種、要件書4.8の表の説明文をラジオの補足に表示）+ 分類理由(必須)。
- 登録時に**分類別フォロータスクを自動生成**（origin='schedule'、next_actions_jsonにも保存）:
  - A_short_term: 当日 御礼+議事録 / 3営業日 提案書送付 / 7日 稟議確認 / 14日 事例・ROI資料 / 21日 決裁者MTG打診 / 30日 受注可否判断
  - B_subsidy_budget: 当日 助成金整理 / 3日 シミュレーション送付 / 7日 人数・予算確認 / 14日 社労士案内 / 30日 予算化判断 / 45日 時期確定
  - C_multi_stakeholder: 当日 関係者整理 / 3日 部署別課題仮説 / 7日 関係者MTG依頼 / 14日 部門別提案 / 30日 PoC提案
  - D_long_term: 30日ごと接触タスク1件（次回分のみ生成、完了時に次を生成）
  - E_nurturing: タスク生成なし（リードのnurture_statusを'active'へ、WO-06連携。WO-06未完なら何もしない）
- 分類変更時: 旧origin='schedule'の**未完了**タスクを削除して再生成（完了済みは残す）。

### 2. 本部承認（本部側）
- `/app/hq` に「承認待ち分類」ウィジェット: 案件名/顧客/分類/理由/営業担当。承認・差戻し（コメント必須）・修正依頼。
- 承認ステータスは案件詳細にも表示。差戻し時は営業担当のマイダッシュボードに表示。
- `enforce_hq_approval=true` のとき: 未承認案件のヨミを 3.C より上（2.B/1.A/0）へ変更しようとするとサーバー側で拒否（エラーメッセージに理由）。falseなら警告表示のみ。

### 3. テンプレの営業への露出
- 案件詳細・リード詳細に「参考テンプレ」折りたたみ: 顧客のindustry・担当者title に一致する業種/職種テンプレを表示（完全一致→部分一致）。
- `/app/settings` にテンプレ管理タブ（一覧・編集・追加）。

## 受入基準（V-05）
- [ ] 初回商談済み・分類未登録の案件にバッジが出る
- [ ] A_short_term登録→6タスクが正しいdue（営業日計算含む）で生成
- [ ] 分類変更→未完了タスクのみ差し替わる
- [ ] 差戻し→営業のマイダッシュボードに表示、コメントが見える
- [ ] enforce_hq_approval=true で未承認案件のヨミを2.Bに上げる→拒否。false→警告のみで保存可
- [ ] 業種8+職種6テンプレがシードされ、該当顧客の案件詳細に表示
- [ ] build/typecheck/advisors ERROR=0
