# CATORCE Sales OS 改善マスタープラン（2026-07）

> **位置づけ**: 本書は改善プロジェクト全体の設計書。実装は各ワークオーダー（`WO-00`〜`WO-08`）を実行AI（Sonnet）が順に遂行する。
> **前提資料**: `docs/CURRENT_SPEC_2026-07.md`（現状）/ `docs/IMPROVEMENT_PROPOSAL_2026-07.md`（初期提案）/ ユーザー提供「カトルセCRM/SFA 追加要件定義書」（2026-07-04、以下「要件書」）
> **確定方針（ユーザー決定）**: **方針1 = CATORCEを商談・顧客管理の一次システムとし、Notionは段階廃止。**
> **最終ゴール**: CATORCEに一元管理し、**レスポンスよく・複数の営業マンが同時に**活用できる営業OS。

---

## 1. ゴールと成功条件

| # | ゴール | 成功条件（測定可能） |
|---|---|---|
| G1 | 一元管理 | 商談・活動・顧客の日常入力がCATORCEのみで完結。Notion商談ヨミ表の更新が停止する |
| G2 | レスポンス | 主要ページ（ダッシュボード/案件/活動/顧客）のサーバー応答 P75 < 800ms、一覧ペイロード < 300KB |
| G3 | 同時利用 | 複数営業の同時編集で更新消失(lost update)が起きない。編集競合は検知して通知 |
| G4 | 営業の型 | 次回AC必須・ステージ別必須項目・分類別フォローが**システムで強制**される（要件書5章） |
| G5 | 深耕・育成 | 既存顧客ランク別接触管理・トランジション・リードスコアが稼働（要件書KPIが取得可能） |

## 2. 全体アーキテクチャ決定（実行AIはこれに従う。変更にはユーザー承認が必要）

| ID | 決定 | 理由 |
|---|---|---|
| D1 | **加算的スキーマ進化**: 既存テーブルを壊さず列追加・付随テーブル。既存カラムを最大限再利用 | 稼働データ(案件681/リード大量)を守る。§4のマッピング表参照 |
| D2 | **ヨミ(0〜9)を正**とし、要件書のstage(approach/C/B/A/commit/won/lost/hold)は**ヨミから導出**（`yomi_stage`ビュー/関数）。UI表示は両方 | チームの共通言語がヨミ。二重入力を作らない |
| D3 | 重い集計は**RPC（SECURITY DEFINER + 明示テナント + materialized CTE + search_path固定 + authenticated限定）**。ページ側メモリ集計は新規禁止 | RLS再評価タイムアウト対策（実証済みパターン） |
| D4 | データ取得は**ページ単位の部分取得**へ移行。`getWorkspace()`の新規利用は禁止、既存利用は段階削減 | レスポンス改善の本丸 |
| D5 | 同時編集は**updated_at比較のCAS（compare-and-set）**で楽観ロック。古い値での上書きはエラー返却→UI側で再読込促し | G3の最小コスト実現 |
| D6 | アラート（要件書8章）は**読み取り時計算のRPC** `sales_alerts()`。cron/メール通知は将来拡張（スコープ外） | 運用開始が速い。通知基盤は後付け可能 |
| D7 | 自動タスク（トランジション/分類別フォロー）は既存`tasks`テーブルを再利用し、`origin`列で発生源を区別 | テーブル増殖を防ぐ |
| D8 | account_plans(要件書4.5)は**既存`account_nurture`を拡張**して充当。srank_accountsはS顧客の深掘りとして併存 | 概念の重複テーブルを作らない |
| D9 | AI支援(要件書6章)はServer ActionからAnthropic API呼び出し。モデルは`claude-sonnet-5`固定。**ANTHROPIC_API_KEYはVercel環境変数のみ**（コード/リポジトリに書かない） | セキュリティ既定路線 |
| D10 | MAのメール**自動配信はスコープ外**。ナーチャリングは「シナリオ・状態・履歴の管理」まで（配信は既存メールツールで実施し結果を記録） | MA基盤の内製は費用対効果が低い |
| D11 | 本部承認(要件書4.8)は**警告→設定でハードブロック**の2段階。初期は警告のみ（`tenant_settings.enforce_hq_approval`で切替） | 承認滞留で営業が止まる事故を防ぐ |
| D12 | UIは日本語。モバイルは既存レスポンシブ＋活動クイック登録の最適化（専用アプリは作らない） | 要件書13章「商談後5分以内に活動登録」 |

## 3. フェーズ計画（ワークオーダー構成）

依存順。**WO-00→01→02→03は直列推奨**（土台→入力→動線）。WO-04/05/06は03完了後に並行可。

| WO | 名称 | 要件書対応 | 概要 |
|---|---|---|---|
| **WO-00** | 性能・同時編集の土台 | 13章(非機能) | 部分取得への移行、一覧ページング、CASによる楽観ロック、actions分割、計測 |
| **WO-01** | 案件の一次入力化 | 4.3, 11.2, 15.1 | インライン編集、ヨミボード(カンバン)、保存ビュー、ステージ別必須バリデーション |
| **WO-02** | 活動履歴の刷新 | 4.4, 11.3 | 1活動1行の登録フォーム(項目順は11.3準拠)、登録時の自動更新、提案後7日フォロータスク |
| **WO-03** | IA再編＋2ダッシュボード＋アラート | 7章, 8章 | サイドバー約15項目化、営業担当DB(7.2)、本部DB(7.1)、`sales_alerts` RPC |
| **WO-04** | 既存顧客アカウント営業 | 4.1, 4.5-4.7, 5.1-5.2 | 顧客ランク・接触ルール、アカウントプラン、お土産パッケージ(5種シード)、トランジション＋自動タスク |
| **WO-05** | 新規商談ワークフロー | 4.8, 5.3, 10.2-10.3 | スケジュール分類、本部承認、分類別フォロータスク自動生成、業種/職種テンプレマスタ |
| **WO-06** | リードスコアリング＋ナーチャリング | 4.9-4.11 | スコア自動判定(ルールベース)、ランク別対応、ナーチャリング管理、リード詳細再構成 |
| **WO-07** | AI営業支援 | 6章 | リサーチ/議事録要約/アップセル提案/フォロー文面/会議アジェンダの5機能（APIキー前提） |
| **WO-08** | Notionカットオーバー | (方針1) | 最終取込→Notion凍結→取込機能の格下げ→運用切替チェックリスト |

**要件書のPhase1〜5との対応**: Phase1≒WO-00〜03 / Phase2≒WO-04 / Phase3≒WO-05 / Phase4≒WO-06 / Phase5≒WO-07。

## 4. スキーマ差分マッピング（要件書 → 既存。実行AIの最重要参照）

**原則: 「既存」列があるものは新設禁止。無いものだけ追加。**（2026-07-04 に本番スキーマを実査した結果）

### accounts（要件書4.1）
| 要件書フィールド | 既存 | 対応 |
|---|---|---|
| account_name/industry/employee_count/annual_revenue/website_url | `name`/`industry`/`employee_size`/`revenue_size`/`website_url` | **再利用** |
| account_rank | `rank` あり | **再利用**（S/A/B/C/dormant運用に統一） |
| upsell_potential | `potential` あり | **再利用** |
| primary_owner_id | `owner_user_id` | **再利用** |
| account_type / executive_owner_id / contact_frequency_rule / current_ai_usage_status / unresolved_issues / last_activity_date / next_contact_date | なし | **列追加** |
| existing_customer_score / lead_score | `engagement_score`あり | engagement_scoreを再利用。lead_scoreはleads側 |
| total_revenue / current_fy_revenue_forecast | なし | **保存しない**（opportunities/billingから集計RPCで算出） |

### contacts（4.2）: `decision_role`(≒contact_role) `temperature`(≒relationship) `last_contacted_at` あり → **influence_levelのみ列追加**。他は再利用。

### opportunities（4.3）: `next_action_date/next_action_text/gross_profit/probability/lost_reason/yomi/category(≒product_group)` あり →
**列追加**: `opportunity_type, customer_issue, proposed_solution, budget_status, decision_maker_status, competitor, next_action_owner_id, hq_approval_status, hq_comment, proposal_doc_url, meeting_doc_url, reapproach_date, solution_package_id`。
stageは追加しない（D2: ヨミから導出）。

### activities（4.4）: `activity_type/body/next_action_date/next_action_text` あり →
**列追加**: `purpose, customer_reaction, customer_quote, discovered_issues, upsell_opportunity, budget_check_result, decision_maker_check_result, meeting_recording_url, meeting_minutes_url, ai_summary, hq_comment`。

### leads（4.9）: 非常にリッチ（rank/priority_score/funnel_stage/needs/timing/authority/budget_band/converted_at等）→
**列追加**: `lead_score(=新スコア0-100), nurture_status, first_contact_due_date, converted_opportunity_id`。rankは既存`rank`を再利用（S/A/B/C/D）。

### 新設テーブル
`solution_packages`（4.6＋5種シード）/ `transitions`（4.7）/ `sales_schedules`（4.8）/ `lead_scoring_rules`（4.10、重み設定）/ `nurturing_campaigns`（4.11）/ `nurture_deliveries`（配信記録、D10）。
`account_plans`は新設せず`account_nurture`を拡張（D8）。`tasks`に`origin text`列追加（D7）。

**全新設テーブル共通**: `tenant_id uuid not null` + RLS4点セット（select/insert/update/delete、`current_tenant_ids()`/`can_edit_role()`）+ `set_updated_at`トリガー。

## 5. 横断ルール（全WO共通）

1. **GUARDRAILS.md を必ず先に読む**（環境・セキュリティ・パターン集）。
2. マイグレーションは`0042`から連番。DDL適用後は必ず`get_advisors(security)`を実行しERROR=0を確認。
3. `npm run build`成功＋`npx tsc --noEmit`成功をコミット条件とする。
4. 各WO完了時に**完了報告**（変更ファイル一覧/マイグレーション/検証結果/未了事項）を出力する。
5. 検証は `docs/exec-plan/VERIFICATION.md` の該当WOの項目を**自己実行**し、結果を報告に含める。
6. UIコンポーネントは既存の`src/components/ui/primitives`(PageHeader/Section/StatCard等)と既存Tailwindトークン(teal系)を踏襲。

## 6. ユーザー側の事前準備（実行前に必要なもの）

| WO | 必要なもの | 状態 |
|---|---|---|
| WO-07 | `ANTHROPIC_API_KEY` をVercel環境変数に登録 | **未** |
| WO-08 | Notion側の編集凍結日の決定・営業メンバーへの周知 | **未** |
| （任意/推奨） | 商談ヨミ表CSVの再取込（列マッピング修正後の正データ化）— WO-08の最終取込で代替可 | 未 |
| （済推奨） | Supabaseダッシュボード: Leaked password protection をON | 未 |

## 7. リスクと対応

| リスク | 対応 |
|---|---|
| 必須項目強制で入力負荷が上がり現場が離反 | 必須は要件書の最小限（次回AC/課題/提案余地）。B以上で段階的に増やす（4.3バリデーション準拠）。WO-01で入力所要時間を実測 |
| 本部承認がボトルネック化 | D11（初期は警告のみ） |
| 部分取得移行で画面のデグレ | WOごとに対象ページを限定し、VERIFICATIONの回帰チェックを必須化 |
| AI機能のコスト暴走 | 呼び出しは明示ボタンのみ（自動バックグラウンド実行禁止）。max_tokens上限設定 |
| 実行AIの誤解による破壊的変更 | GUARDRAILSで禁止事項を明文化（全置換・テーブル削除・RLS変更は指示書に明記された場合のみ） |
