# WO-01: 案件の一次入力化（Notion代替の中核）

> 前提: WO-00完了。`GUARDRAILS.md` 必読。要件書4.3 / 11.2 / 15.1 対応。
> **目的**: Notion商談ヨミ表で行っていた日常更新（ヨミ・金額・見込月・次回AC・メモ）をCATORCE上で完結させる。

## スコープ
1. 案件テーブルへの要件書カラム追加
2. 一覧のインライン編集
3. ヨミボード（カンバン）ビュー
4. 保存ビュー（フィルタプリセット）
5. ステージ(ヨミ)別の必須バリデーション
6. 案件詳細画面の再構成（要件書11.2）

## DB変更（migration 0043）
```sql
alter table public.opportunities
  add column if not exists opportunity_type text,          -- new/existing_upsell/renewal/partner/referral
  add column if not exists customer_issue text,
  add column if not exists proposed_solution text,
  add column if not exists budget_status text,             -- confirmed/likely/unknown/none/next_fy
  add column if not exists decision_maker_status text,     -- confirmed/not_confirmed/unknown
  add column if not exists competitor text,
  add column if not exists next_action_owner_id uuid references public.profiles(id),
  add column if not exists hq_approval_status text default 'not_required',
  add column if not exists hq_comment text,
  add column if not exists proposal_doc_url text,
  add column if not exists meeting_doc_url text,
  add column if not exists reapproach_date date,
  add column if not exists solution_package_id uuid;       -- FK はWO-04でsolution_packages作成後に付与
```
- ヨミ→要件書stageの導出関数（表示用・集計用）:
```sql
create or replace function public.yomi_stage(p_yomi text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when p_yomi like '0%' then 'won'
    when p_yomi like '1%' then 'commit'   -- 1.A
    when p_yomi like '2%' then 'A'        -- 2.B(提案済)
    when p_yomi like '3%' then 'B'
    when p_yomi like '4%' or p_yomi like '9%' then 'C'
    when p_yomi like '5%' or p_yomi like '6%' then 'hold'
    when p_yomi like '7%' or p_yomi like '8%' then 'lost'
    else 'approach' end $$;
```
※ この対応表はUIの凡例にも表示（ヨミが正、stageは英語圏表記の別名。MASTER_PLAN D2）。

## 実装詳細

### 1. インライン編集（案件一覧）
- `/app/opportunities` の表ビューで、以下をセル内編集可能に: **ヨミ / 金額 / 見込月(expected_revenue_month) / 次回AC日 / 次回AC内容 / 担当**。
- クライアントコンポーネント `opp-inline-cell.tsx`: クリック→入力→blur/Enterで `updateOpportunityAction`（CAS付き）→ 楽観更新、失敗時トースト＋元値復帰。
- ヨミ変更時は `yomiToFields`（`src/lib/deal-import.ts`）と同じ規則で stage/status/forecast_category/probability を**サーバー側で連動更新**（1箇所に共通関数化し取込と共有）。

### 2. ヨミボード（カンバン）
- 一覧に「表 / ボード / カレンダー」切替（カレンダーは既存 appointment-calendar を流用）。
- ボード列 = ヨミ大分類: `1.A / 2.B / 3.C / 4.アポ / 9.調整中 / 5.リスケ / 6.定期追い`（0受注・7,8失注は列に出さずフィルタで表示可）。
- カード: 会社名 / 案件名 / 金額 / 見込月 / 次回AC日（超過は赤） / 担当アバター。
- ドラッグ&ドロップでヨミ変更（HTML5 DnDで十分。ライブラリ追加は不可、依存を増やさない）。ドロップ時に確認なしで保存、CAS競合時は再読込トースト。

### 3. 保存ビュー
- WO-00でURLパラメータ化した絞込条件に名前を付けて保存。既存 `lead_export_presets` と同様の軽量テーブル:
```sql
create table public.opp_view_presets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  owner_user_id uuid not null,
  name text not null,
  params jsonb not null,
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```
（RLS4点＋set_updated_atトリガー。共有ONならテナント内全員が閲覧選択可）

### 4. ステージ別必須バリデーション（要件書4.3準拠、サーバー側で強制）
- `src/server/actions/opportunities.ts` に検証関数 `validateOppRequiredFields(opp)`:
  - ヨミ 3.C以上（3/2/1/0）で: `next_action_date` `next_action_text` `customer_issue` 必須
  - ヨミ 2.B以上（2/1/0）で: `amount>0` `expected_close_date`、かつ `proposal_doc_url` または `proposed_solution` のどちらか必須
  - ヨミ 7/8（失注）で: `lost_reason` 必須、`reapproach_date` または「再アプローチ不要」フラグ（lost_reasonに `[再アプローチ不要]` プレフィックスで代替可）必須
- 不足時はエラーを返し**保存させない**。エラーメッセージは「どの項目が足りないか」を日本語で列挙。
- **既存データへの遡及適用はしない**（更新時のみ検証）。取込済みデータが引っかかって編集不能になるのを防ぐため、「変更していないフィールドの既存不備」は警告表示に留める。

### 5. 案件詳細画面の再構成（要件書11.2の15セクション）
- 順序: 概要 / 顧客課題 / 提案内容 / 商品群・パッケージ / 確度・金額・売上月 / 予算確認 / 決裁者確認 / 競合 / 提案書・議事録URL / 活動履歴 / 次回AC / スケジュール分類(WO-05でリンク) / 本部承認 / 失注・保留理由 / AI支援(WO-07でリンク)。
- 全フィールドをその場で編集可能（フォーム分割: セクションごとに保存ボタン、またはblur保存）。
- 未実装セクション（分類/AI）はプレースホルダーカード「WO-05/WO-07で提供予定」を置かず、**単に非表示**にする（ユーザーに未完成感を見せない）。

## 受入基準（V-01）
- [ ] 一覧でヨミをインライン変更→確度/forecastが連動し、リロード後も保持
- [ ] ボードでカードをドラッグ→ヨミ変更が保存される
- [ ] ヨミ2.Bの案件で金額0のまま保存→日本語エラーで拒否
- [ ] 失注へ変更時、失注理由なしでは保存不可
- [ ] 保存ビュー: 絞込→保存→別ページから復元
- [ ] 同時編集: 2セッションで同一案件更新→後発がCASエラー表示
- [ ] build/typecheck/advisors ERROR=0
