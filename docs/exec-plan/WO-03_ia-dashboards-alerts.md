# WO-03: IA再編＋2ダッシュボード＋アラート基盤

> 前提: WO-00〜02完了。要件書7章 / 8章、IMPROVEMENT_PROPOSAL §A 対応。
> **目的**: 導線37項目→約15項目。役割別ダッシュボード（営業担当/本部）で「今日やるべきこと」「営業の問題」が即見える。

## スコープ
1. `sales_alerts` RPC（要件書8章の全アラートを読み取り時計算）
2. 営業担当ダッシュボード（要件書7.2）
3. 本部ダッシュボード（要件書7.1）
4. サイドバー再編＋分析ハブ

## DB変更（migration 0045）
- `sales_alerts()` RPC（GUARDRAILSテンプレ準拠）。返却: `jsonb` 配列 `[{kind, severity, account_id, opportunity_id, owner_user_id, label, due_date}]`。
- 実装するアラート種別（要件書8章。データが未整備の種別も条件式だけ実装し、該当0件なら0件と出す）:

| kind | 条件 |
|---|---|
| ac_overdue | status='open' かつ next_action_date < current_date |
| ac_missing | status='open' かつ next_action_date is null |
| s_account_stale | accounts.rank='S' かつ last_activity_date < now()-30日 (nullも該当) |
| a_account_stale | rank='A' かつ 60日 同上 |
| delivery_followup_3d / proposal_30d | transitions（WO-04後に有効化。テーブル無ければ空配列を返すようto_regclassでガード） |
| proposal_followup_7d | 未完了タスク origin='followup7d' で due_date < current_date |
| budget_unknown_b | yomi_stage in ('B','A','commit') かつ budget_status in (null,'unknown') |
| no_proposal_a | yomi_stage in ('A','commit') かつ proposal_doc_url is null かつ proposed_solution is null |
| lost_no_reason | status='lost' かつ lost_reason is null |
| no_reapproach | status='lost' かつ reapproach_date is null かつ lost_reason not like '[再アプローチ不要]%' |

## 実装詳細

### 1. 営業担当ダッシュボード `/app/dashboard`（既存を役割別に再構成）
- ログインユーザー向けセクション（要件書7.2）:
  - **今日の次回AC**（自分担当・next_action_date<=今日、超過は赤）
  - 期限超過タスク / 自分のA・B案件（ヨミ1,2） / 自分の担当S・A顧客で接触期限が近いもの
  - 新規割当リード（未接触） / 入力漏れアラート（sales_alertsの自分分）
- 既存の全社サマリー（着地・ファネル）は下部に維持（本部ダッシュボードと共通コンポーネント化）。

### 2. 本部ダッシュボード `/app/hq`（新設。要件書7.1）
- 今月受注見込（確度別・商品別・営業別） / 加重売上 / A・B案件一覧 / **次回AC超過・未設定案件** / S・A顧客接触率（分母=対象顧客数、分子=期限内接触） / 提案後7日フォロー率 / 失注理由ランキング / 営業担当別KPI（活動数・次回AC遵守率・受注額）。
- 集計は新RPC `hq_dashboard(p_month date)` に集約（1往復）。
- お土産提案数・研修後アップセル率・リード商談化率はWO-04/06完了後に有効化（RPC内でテーブル存在ガード、UIは値が無ければ非表示）。

### 3. サイドバー再編（`src/components/layout/sidebar.tsx`）
```
■ ホーム        : マイダッシュボード / 本部ダッシュボード / タスク
■ 案件          : 案件(表・ボード) / 売上予測(来期タブ統合) / 目標入力
■ 顧客          : 顧客 / 担当者 / リード / アカウントプラン(WO-04) / Sランク攻略
■ 活動          : 活動履歴(+登録)
■ 分析          : 分析ハブ(1項目。ハブ内タブ: 施策ROI / 展示会 / セミナー / トレンド / 営業別 / 商品別 / 収益)
■ 経営レビュー  : exec(1項目に折りたたみ、クリックで既存9画面へのハブページ)
■ 設定          : 設定 / データ取込(商談/リード/セミナー/原価の4取込への入口を1ページに集約)
```
- **旧ルートは削除しない**（ブックマーク・回帰対策）。サイドバーから消すだけ。分析ハブ `/app/analytics` はカード+タブで既存ページへ誘導（iframe化や画面複製はしない。まずリンク集約で導線を減らし、画面統合は将来）。
- `/app/forecast` に受注見込み(pipeline)をタブとして統合（既存 `/app/forecast/pipeline` はタブから読み込み or リダイレクト）。

## 受入基準（V-03）
- [ ] サイドバー項目数 ≤ 16（数えて報告）
- [ ] `/app/dashboard` に「今日の次回AC」「自分のA/B案件」「入力漏れ」が自分のデータで表示
- [ ] `/app/hq` が1RPCで描画され、AC超過・未設定件数が実データと一致（SQLで突合し報告)
- [ ] sales_alerts が認証コンテキスト検証(GUARDRAILS §3-3)で 8s 以内(実測値を報告、目標<500ms)
- [ ] 旧URLに直接アクセスしても全ページ表示可能
- [ ] build/typecheck/advisors ERROR=0
