# 機能総点検・改善ロードマップ 2026-07

**作成日**: 2026-07-17
**対象**: CATORCE Sales OS(コミット `1463cf2` 時点、migration 0001〜0138、画面104・メニュー32+、テーブル約110)
**目的**: 実装は行わず、(1) 機能の棚卸しと重複・漏れ・導線の整理 (2) 非機能(性能・セキュリティ・拡張性)の整理 (3) インフラ移行閾値の可視化 (4) 改善バックログの提示

> 調査ソース: コードベース静的解析(全画面・全Server Action・全migration)+ Supabase本番プロジェクトのアドバイザリー実測(security 55件 / performance 329件)+ `docs/` 過去計画文書16本の突合。

---

## 0. エグゼクティブサマリー

| 観点 | 現状評価 | 一言 |
|---|---|---|
| 機能カバレッジ | ◎ 非常に広い | CRM/SFA+BO+HR+タスク管理+分析まで104画面。社内利用のFEATURE_BACKLOGはほぼ完了宣言済み |
| 機能の重複 | ▲ 顕在化 | 「営業担当別」4画面・「失注分析」2画面・「受注見込み」3系統など11領域で重畳 |
| 利用実態との乖離 | ▲ 要注視 | 本番110テーブル中 **約40テーブルが0行**。作ったが使われていない機能群が導線を圧迫 |
| 導線・IA | ▲ 肥大 | サイドバー32項目+サブタブ多数。孤立ページ(`/app/forecast/pipeline`)あり |
| 性能 | ○ 改善進行中 | 7/12のFree tier CPU飽和障害はアプリ側修正済み。ただし `getWorkspace` 依存が34ファイルに残存、サーバーキャッシュ未導入、FK未インデックス177件 |
| セキュリティ | ○ 基礎は堅牢 | RLS全テーブル有効・既知重大所見は修正済み。残: audit_logsの閲覧範囲、timing-safe比較4経路、レート制限不在 等 |
| 拡張性(外販) | ✕ 未着手 | 単一テナント前提のハードコード多数・RLS自動テスト0件・CI不在。「社内利用は成熟、SaaS外販readinessは設計文書段階」 |
| インフラ | ⚠ 移行推奨期 | Free構成の限界に一度接触済み(7/12障害)。**録音・添付の本格利用 or 商用利用コンプライアンスの観点で Stage 1(約¥7,000/月)への移行を推奨** |

**最重要提言(3点)**:
1. **「足すフェーズ」から「束ねるフェーズ」へ**。機能追加は十分。重複統合と0行テーブル機能の棚卸し(廃止 or 定着施策)で認知負荷を下げる。
2. **計算ロジックの単一ソース化**。加重予測式が5+箇所、確度スケールが0-100と0-1で混在。数字を扱うSaaSとして最優先の技術負債。
3. **インフラはStage 1へ計画移行**。無料構成の商用利用リスク(Vercel Hobby規約)とバックアップ不在は、障害が起きてからでは遅い。

---

## 1. 機能マップ(現状の棚卸し)

### 1.1 領域別の機能一覧

| 領域 | 画面 | 主な機能 | 本番利用実態(行数) |
|---|---|---|---|
| **ホーム/実行** | dashboard, today, review, checklist, tasks(6タブ), activities | KPI着地・今日のアポ・AI確認キュー・型チェック・タスク | opportunities 785 / meetings 715 / tasks 413 → **活発** |
| **案件(SFA)** | appointments/new, opportunities(+詳細/商談メモ/見積), reps, forecast(5タブ), targets, work, projects | 商談・ヨミ・予測・目標・稼働・原価 | stage_histories 64 / yomi_change_logs 44 → 利用中 |
| **顧客** | accounts, contacts, business-cards, leads, srank, nurture, knowledge, playbooks | 顧客・名刺・リード・攻略・深耕・ナレッジ | leads 8,271 / business_cards 3,685 / touchpoints 10,284 → **活発**。ただし srank_accounts 0 / account_nurture 0 / sales_playbooks 0 |
| **分析・レビュー** | analytics配下16画面, xray, winloss, exec配下9画面, reviews配下4画面, content | ROI・レントゲン・週次レビュー・経営レビュー | revenue_forecasts 65 / xray_snapshots 1 / weekly_reviews 0 / weekly_kpi_targets 0 / forecast_snapshots 0 |
| **バックオフィス** | bo配下7画面 | 助成金・研修後FU・展示会WBS・講師・事例・アンケート | fu_meetings 123 / seminar_responses 129 / training_sessions 18 → 利用中。expo_projects 0 / case_studies 0 |
| **人事** | hr配下3領域 | 求人・候補者・タレント | talents 41 / candidates 1 → 立ち上げ期 |
| **設定** | settings(+duplicates/trash/audit), opportunities/import | メンバー・マスタ・監査・取込 | audit_logs 1,166 → 稼働中 |
| **自動化(API)** | cron×4, batch×2, lead-intake, calendar, warm | 朝ダイジェスト・夜間AI(方針A: 従量課金ゼロ)・録音文字起こし・Web取込・ICS | batch_runs 10 / meeting_recordings 3 |

### 1.2 「漏れ」の整理 — 2種類ある

**(a) 未実装として明示的に残っているもの**(FEATURE_BACKLOG残項目):
- D-4続き: 事前リサーチAI・お土産提案AI
- D-2: Googleカレンダー双方向連携
- D-3: 請求書発行(見積書はあり)

**(b) 実装済みだが使われていない「定着漏れ」**(本番0行 ≒ 40テーブル。抜粋):

| 機能 | テーブル(0行) | 判断が必要 |
|---|---|---|
| 週次レビュー/KPI | weekly_reviews, weekly_kpi_targets/results, mtg_actions | READMEで「最重要」と謳う画面が未使用。運用定着 or 経営レビュー(exec)への統合 |
| Sランク攻略 | srank_accounts/departments/keypersons | 3画面分の導線を維持する価値の再判断 |
| 既存顧客深耕 | account_nurture, nurture_touches | 同上 |
| 商品明細 | opportunity_products | 商談×商品の分析(product-roi)の前提データが空 |
| 予測スナップショット | forecast_snapshots | 予測精度検証(振り返り)が機能していない |
| 展示会WBS | expo_projects/tasks/staffing | テンプレは8件あるが実案件0 |
| ゴール/事例/提案版管理 ほか | goals, case_studies, proposal_versions, attachments, tenant_settings 等 | 個別に「廃止/隠す/定着させる」の三択判断 |

> **コンサル所見**: 0行テーブルは「機能の漏れ」ではなく「**運用の漏れ**」。これらがサイドバーに並び続けることが導線のわかりにくさの主因になっている。四半期ごとの「利用実態レビュー」(行数・アクセスログベース)をガバナンスとして導入すべき。

---

## 2. 重複の確認(統合候補)

### 2.1 画面レベルの重複(11領域)

| # | 重複領域 | 現状 | 統合案 |
|---|---|---|---|
| D-01 | **失注分析が2画面** | `/analytics/lost` と `/analytics/winloss` がほぼ同テーマ | winlossに一本化し、lostはリダイレクト |
| D-02 | **受注見込みが3系統** | forecastの「受注見込み」タブ / `/forecast/pipeline`(孤立) / dashboardの6ヶ月予測 | forecastタブに集約。pipelineは導線接続 or 廃止 |
| D-03 | **営業担当別ビューが4画面** | reps, reps/[id], analytics/sales-reps, reviews/rep | 「営業ビュー」1画面+タブ構成(現在/分析/週報)へ |
| D-04 | **展示会が4+1画面** | exhibitions, exhibition-roi, exhibition-select, roi(施策), bo/expos | 「展示会ハブ」1画面へ集約(準備WBSはBOのまま) |
| D-05 | **経営/週次ダッシュボード重畳** | dashboard, exec, exec/kpi, reviews/weekly で今月着地・KPIが多重表示 | 役割定義を明文化(日次=dashboard/週次=weekly/月次=exec)し重複ウィジェット削除 |
| D-06 | **ヨミ編集の入口が5箇所** | 一覧インライン・詳細・forecast予測入力・today・accounts詳細 | 編集は共通ドロワー化(1コンポーネント)し、どこから開いても同一UI |
| D-07 | **「やること」系が5画面** | tasks, tasks/meetings, checklist, review, today(+dashboardアラート) | 「今日やること」ハブに統合、種類はフィルタで表現 |
| D-08 | **原価・案件管理** | projects と exec/projects | 参照系をexecに、編集系をprojectsに役割分離 or 統合 |
| D-09 | **ナレッジ系3画面が同型** | knowledge, playbooks, content | 「ナレッジ」1メニュー+タブ化 |
| D-10 | **研修後フォロー2系統** | bo/followups と accounts/[id]のトランジション | データソース共通化を確認の上、片方をビューに |
| D-11 | **稼働報告の二重掲載** | `/app/work` が営業・BO両サイドバーに登場 | 意図的なら現状維持(明記のみ) |

### 2.2 コードレベルの重複(技術負債)

| # | 重複 | 箇所 | リスク |
|---|---|---|---|
| C-01 | **加重予測式 `amount×probability` が5+箇所に散在** | `select.ts:66` `dashboard.ts:88` `subscription.ts:91` `revenue-forecast.ts:108` + SQL側RPC(workspace_*, opportunities_page, dashboard_metrics)でも二重実装 | 修正漏れで画面ごとに数字が食い違う事故 |
| C-02 | **確度スケールの混在**(0-100 と 0-1) | opportunities系=0-100 / revenue-forecast系=0-1(`revenue-forecast.ts:35-50`) | **数値バグの温床。最優先で統一 or 型で分離** |
| C-03 | ステージ→確度マッピングが2系統 | `constants.ts:27-38` と `deal-import.ts:82-92` | 取込データと画面入力で確度がズレる |
| C-04 | accounts全件走査+JS名寄せのコピペ | `actions.ts:153` ≒ `appointments.ts:157`(`.limit(1000)`) | 顧客1,000件超(現在738件、**残り余裕35%**)で名寄せが静かに欠落 |
| C-05 | バッチRouteの認可/ログ処理コピペ | meeting-summary ≒ content-draft(`authFail`/`jobDisabled`/`jstDate`) | 共通モジュール化 |
| C-06 | JST日付算出が4+箇所に個別実装 | daily-digest, xray-snapshot, batch×2 | タイムゾーンバグの温床 |
| C-07 | OppView変換が3系統 | `leanToOppView`/`miniToOppView`/`toOppView` | フィールド差異による表示不整合 |
| C-08 | UIコンポーネントの並行実装 | opp-table/opp-paginated-table、accounts-table/accounts-paginated-table、appointment-calendar/同pro | ページング版に一本化 |
| C-09 | `actions.ts` が2,363行の巨大ハブのまま | 分割は33ファイル進行中だが未完遂 | 分割完遂+戻り値規約(`{ok,error}` vs redirect)の統一 |

---

## 3. 導線・IA(情報設計)の課題

1. **サイドバー32項目は認知限界超え**。過去提案(IMPROVEMENT_PROPOSAL: 37→約15)の再始動を推奨。§2.1の統合を先に行えば自然に25→18程度まで減る。
2. **孤立ページ**: `/app/forecast/pipeline` はコード全体にリンクが存在せずURL直打ちのみ。しかもforecastの「受注見込み」タブと名称衝突。
3. **役割ベースの再グルーピング案**(参考):
   - 「今日」(today/review/checklist/tasks統合ハブ)
   - 「商談」(opportunities/appointments/forecast/targets)
   - 「顧客」(accounts/contacts/business-cards/leads)
   - 「攻略」(srank/nurture/knowledge/playbooks → 定着判断後に1メニュー)
   - 「分析」(analytics hub/xray/winloss)
   - 「レビュー」(weekly/rep/exec 役割定義後)
   - 「BO」「人事」「設定」
4. **深い階層のタブ発見性**: exec配下8サブページ・analytics配下16ページはハブページ経由でしか気付けない。よく使う3-4個に絞ってサイドバー直下へ、残りはハブ内カードで十分。
5. **「暫定」表示の放置**: ROI・粗利に「(暫定)」ラベルが本番表示に残る(`roi.ts:4` ほか)。しきい値を設定画面に出すか表記を外す判断を。

---

## 4. 非機能の整理

### 4.1 レスポンス(性能)

**現状**: 7/12にFree tier CPU飽和で全画面タイムアウト障害が発生 → アプリ側修正(RLS initplan化でleads全件 4.6s→6.7ms)済み。基礎体力は改善したが、構造的な課題が残る。

| # | 課題 | 実測/根拠 | 対策 |
|---|---|---|---|
| P-01 | `getWorkspace(Lite)` 一括取得(2.1MB/1.3MB)が**34ファイル71箇所**に残存 | targets, forecast, exec配下, analytics配下ほか | GUARDRAILS「新規利用禁止」は徹底済。既存分を部分取得へ計画的に移行(VERIFICATIONの単調減少ゲート活用) |
| P-02 | サーバーキャッシュ未導入 | `unstable_cache`/`revalidate` 使用0件。全104画面中92が`force-dynamic` | マスタ・分析系の重RPCに `unstable_cache`+タグ再検証を導入(ミューテーション時`revalidateTag`) |
| P-03 | **FK未インデックス177件**(本番advisor実測) | leads×8, opportunities×8, tasks×4 など | ホットテーブルから順次索引追加。`memberships(user_id)`単独索引もRLSホットパスとして追加 |
| P-04 | **重複permissiveポリシー100件**(本番advisor実測) | lead_source_details×10, マスタ系×5多数 | ポリシー統合(action毎1本化)。RLS評価コスト削減 |
| P-05 | 未使用インデックス36件(本番advisor実測) | — | 書込コスト削減のため棚卸し |
| P-06 | サイレント欠落の上限 | daily-digest `.slice(0,500)`、calendar `.limit(500)`、accounts名寄せ `.limit(1000)` | 上限超過時の警告ログ or ページング化 |
| P-07 | JS側集計が残る分析ページ | trends/channels/sales-reps/products/seminars/revenue | RPC集計化(既存の`lead_metrics`方式を横展開) |

### 4.2 セキュリティ

**現状**: RLSは全業務テーブルで有効、既知重大所見(S1-S9)は0112-0114で修正済み。基礎は堅牢。残課題:

| # | 課題 | 深刻度 | 根拠 |
|---|---|---|---|
| S-01 | `audit_logs` の閲覧がテナント全員(external_salesが担当外商談の金額変更履歴まで閲覧可) | 中 | `0064` L73(当初のowner/admin限定から緩和された) |
| S-02 | SECURITY DEFINER関数52本がauthenticatedから実行可能、`sync_next_action_task()` は**anonからも実行可能** | 中 | 本番advisor実測55件。EXECUTE剥奪 or INVOKER化の棚卸し |
| S-03 | トークン照合の非定数時間比較が4経路 | 中 | lead-intake:47, calendar:25, recordings/audio:14, models:24 → `secure-compare`へ統一 |
| S-04 | 初回メンバー発行にパスワード強度検証なし | 中 | `actions.ts:1364-1367`(変更時は8文字チェックあり、発行時のみ欠落) |
| S-05 | Turnstile fail-open+アプリ層レート制限不在 | 中 | 未設定環境ではブルートフォース耐性がSupabase Auth頼み |
| S-06 | 漏洩パスワード保護(HaveIBeenPwned連携)が無効 | 低 | 本番advisor実測。ダッシュボードでON1分作業 |
| S-07 | `pg_net` がpublicスキーマに設置 | 低 | 本番advisor実測 |
| S-08 | service role使用箇所(19ファイル)で `deleted_at`/`tenant_id` フィルタ手書き | 構造リスク | 1箇所の書き漏らしが即漏洩。共通クエリビルダ化 or ビュー経由に |
| S-09 | サイレント失敗(空catch)がSentryに乗らない | 低 | daily-digest等の副次処理。`Sentry.captureException`挿入 |

### 4.3 拡張性(マルチテナント外販)

| # | ブロッカー | 根拠 |
|---|---|---|
| X-01 | バッチ/cron/公開APIが単一テナント固定 | `TENANT_ID="00000000-...0001"` ハードコード(batch×2)、`tenants`先頭1件採用(daily-digest, lead-intake, calendar, xray) |
| X-02 | CATORCE固有マスタがコード定数 | `constants.ts`: 商材16(価格・粗利率込み)・流入経路14・ステージ12・ヨミ0-9(日本語ラベルがロジックキー)・パートナー名。`tenant_settings`テーブルは存在するが読込ゼロ |
| X-03 | 会計年度7月開始固定 | `fiscal.ts:9` |
| X-04 | ブランド直書き | 「株式会社カトルセ」がtopbar/quote/login/calendar等に |
| X-05 | RLSテナント分離・ロール可視性の自動テスト0件 | PRODUCT_GAP A-02「外販で最も事故が許されない箇所」 |
| X-06 | CIゲート不在(.github/workflows なし)・E2E 0件 | テストは純関数ユニット10本のみ |
| X-07 | テナントオンボーディング不在 | `provision_tenant()`なし。「今2社目を作ると空画面」 |
| X-08 | feature flags不在 | 展示会/セミナー等カトルセGTM特化画面のON/OFF不可 |
| X-09 | AIモデルIDが設計文書と乖離 | MASTER_PLAN D9は`claude-sonnet-5`固定と規定、実装は`ai.ts:45`で`claude-opus-4-8`。どちらかに正す |

---

## 5. インフラ: 無料で出来ることと移行閾値の可視化

### 5.1 現在の構成と実測値

- **Supabase Free**(東京): DB約110テーブル。ホット行数: touchpoints 10,284 / leads 8,271 / person_engagement 8,066 / business_cards 3,685 / opportunities 785
- **Vercel Hobby想定**(hnd1固定、cron 2本=Hobby上限ちょうど)
- **AI**: 方針A(夜間Claude Codeコンテナ)により従量課金ゼロを維持。SDK直接利用は商談要約1機能のみ

### 5.2 無料プランの「壁」と現在地

```
                いま(20ユーザー・1テナント)
                    │
  ──────────────────┼──────────────────────────────────────────▶ 成長
                    │
【壁1】Vercel Hobby商用利用規約     ◀━ すでに抵触リスク(社内業務の商用利用)
【壁2】バックアップ不在              ◀━ すでにリスク顕在(Freeは日次バックアップなし。
                                        誤削除・障害時の復旧手段はゴミ箱30日のみ)
【壁3】共有CPU(Nano)の飽和          ◀━ 7/12に一度接触(アプリ側修正で回避中)
                                        再接触目安: ホットテーブル5-10万行 or 同時利用20-30人
【壁4】ストレージ1GB                 ◀━ 録音機能の本格利用で最速到達
                                        (音声~50MB/h → 商談録音20件程度で満杯)
【壁5】DB容量500MB                   ── 現状余裕(推定数十MB)。リード・接点の
                                        現ペース成長なら1-2年は非到達
【壁6】egress 5GB/月                 ── 2.1MBのworkspace_fullが残存するため、
                                        利用者増で先に接触しうる(20人×5PV/日×2MB≒6GB/月)
【壁7】MAU 5万                       ── 実質無関係(社内20人)
```

### 5.3 段階別インフラプラン(移行トリガーつき)

| Stage | 構成 | 月額目安 | 移行トリガー(いずれか1つで移行) |
|---|---|---|---|
| **Stage 0**(現状) | Supabase Free + Vercel Hobby | ¥0 | — 続行条件: 録音・添付を本格利用しない/バックアップ不在を許容/アプリ側性能改善(P-01〜04)を継続 |
| **Stage 1**(推奨: 今四半期中) | **Supabase Pro($25) + Vercel Pro($20)** | 約¥7,000 | ①商用利用コンプライアンスを正す(即時要件) ②録音/添付の本格利用開始 ③日次バックアップが必要と判断した時点 ④egress 5GB接触 ⑤2度目のCPU飽和 |
| **Stage 2** | Stage 1 + Supabase Compute増強(Small〜Medium +$10〜60) | 約¥9,000〜15,000 | ①社員30人超 or 同時利用20人超 ②ホットテーブル10万行超 ③p95>800ms(VERIFICATION性能予算)が索引・キャッシュ導入後も継続 |
| **Stage 3**(外販開始時) | Supabase Pro+PITR / 必要に応じTeam($599) + 監視強化(Sentry有償等) | 約¥15,000〜10万+ | ①2社目のテナント受入(=X-01〜X-08解消が前提条件) ②SLA/セキュリティチェックシート対応が契約要件になった時点 ③PITR(数分単位復旧)が要件化 |

> **ポイント**: Stage 1移行は「性能のため」ではなく「**商用利用の適法性とデータ保全**」のため。性能はアプリ側改善(P-01〜P-07)の方が費用対効果が高く、Compute増強(Stage 2)は索引・キャッシュ導入後にまだ遅い場合の最終手段とする。

### 5.4 コスト効率の現状評価

- AI従量課金ゼロ方針(方針A)は秀逸。外販時のみ機能単位で方針B(API)へ昇格する設計も妥当。
- `warm` エンドポイントによるコールドスタート緩和は、Vercel Pro移行後は不要になる可能性(要計測)。

---

## 6. 改善バックログ(優先度つき)

凡例: 工数 S=~1日 / M=~1週 / L=数週。**実装は本書のスコープ外**(リストアップのみ)。

### Phase 0: 即応(今週〜2週間)— セキュリティ即応+迷子導線

| ID | 項目 | 優先度 | 工数 |
|---|---|---|---|
| B-001 | `sync_next_action_task()` のanon実行剥奪(S-02の最重要1件) | P0 | S |
| B-002 | 漏洩パスワード保護ON(S-06)+pg_netスキーマ移動(S-07) | P0 | S |
| B-003 | audit_logs閲覧をowner/admin(+本人分)へ戻す(S-01) | P0 | S |
| B-004 | トークン照合4経路をsecure-compareへ統一(S-03) | P1 | S |
| B-005 | メンバー発行時のパスワード強度検証追加(S-04) | P1 | S |
| B-006 | `/app/forecast/pipeline` の導線接続 or 廃止判断(IA-02) | P1 | S |
| B-007 | Vercel Pro/Supabase Pro移行の意思決定(Stage 1) | P0 | 判断のみ |

### Phase 1: 束ねる(今月〜1.5ヶ月)— 重複統合とIA再編

| ID | 項目 | 優先度 | 工数 |
|---|---|---|---|
| B-101 | **0行テーブル機能の利用実態レビュー会**(廃止/隠す/定着の三択を機能ごとに決定。§1.2(b)) | P0 | 判断+S |
| B-102 | 加重予測式のユーティリティ統一+確度スケール統一(C-01, C-02) | P0 | M |
| B-103 | ステージ→確度マッピング一本化(C-03) | P1 | S |
| B-104 | 失注分析2画面の統合(D-01) | P1 | S |
| B-105 | 営業担当別4画面→1画面タブ化(D-03) | P1 | M |
| B-106 | 「やること」5画面→ハブ統合(D-07) | P1 | M |
| B-107 | 展示会4画面→ハブ統合(D-04) | P2 | M |
| B-108 | ナレッジ系3画面→1メニュータブ化(D-09) | P2 | S |
| B-109 | サイドバー再編(32→18目安、B-101/104-108の結果を反映) | P1 | M |
| B-110 | ヨミ編集の共通ドロワー化(D-06) | P2 | M |
| B-111 | dashboard/exec/weeklyの役割定義と重複ウィジェット削除(D-05) | P2 | M |

### Phase 2: 足腰(1〜3ヶ月)— 性能・品質基盤

| ID | 項目 | 優先度 | 工数 |
|---|---|---|---|
| B-201 | ホットテーブルのFK索引追加(P-03: leads/opps/tasksから)+`memberships(user_id)` | P0 | S |
| B-202 | 重複permissiveポリシーの統合(P-04: 100件→半減目標) | P1 | M |
| B-203 | `unstable_cache`+`revalidateTag`導入(マスタ→分析系の順)(P-02) | P1 | M |
| B-204 | getWorkspace残34ファイルの部分取得移行(P-01: 四半期で半減目標) | P1 | L |
| B-205 | accounts名寄せの全件走査解消+共通化(C-04: 顧客738/1000件で猶予僅か) | P0 | S |
| B-206 | サイレント上限の警告化(P-06)+空catchのSentry捕捉(S-09) | P2 | S |
| B-207 | CIゲート構築(build+tsc+vitest、GitHub Actions)(X-06) | P0 | S |
| B-208 | **RLSテナント分離・ロール可視性の自動テスト**(X-05) | P0 | M |
| B-209 | 主要動線のE2Eスモーク(ログイン→商談編集→予測の13ページ回帰) | P1 | M |
| B-210 | zodによる入力バリデーション共通化+Server Action戻り値規約統一(C-09) | P1 | L |
| B-211 | actions.ts(2,363行)の分割完遂 | P2 | M |
| B-212 | バッチRoute共通化(C-05)+JST日付ユーティリティ(C-06) | P2 | S |
| B-213 | ログイン試行レート制限 or Turnstile必須化(S-05) | P1 | S |
| B-214 | 未使用インデックス36件の棚卸し(P-05) | P3 | S |
| B-215 | Sentry DSN本番設定+アラート運用開始 | P1 | S |

### Phase 3: 外販準備(経営判断後)— マルチテナント化

> 前提: PRODUCT_GAPの経営判断3点(外販形態/ターゲット/品質投資)の決着。判断前の着手は非推奨。

| ID | 項目 | 優先度 | 工数 |
|---|---|---|---|
| B-301 | 単一テナント固定の解消(X-01: batch/cron/lead-intake/calendarのテナントループ化) | P0 | M |
| B-302 | constants→tenant_settings移行(X-02: 商材・経路・ステージ・ヨミ・目標) | P0 | L |
| B-303 | 会計年度・ブランドのテナント設定化(X-03, X-04) | P1 | M |
| B-304 | `provision_tenant()` オンボーディング(X-07) | P0 | M |
| B-305 | feature flags(画面単位ON/OFF)(X-08) | P1 | M |
| B-306 | service roleクエリの共通ガード化(S-08) | P1 | M |
| B-307 | 多テナント前提のセキュリティ再監査(AUDIT §C指定箇所) | P0 | M |
| B-308 | AIモデルIDの設計/実装整合(X-09)+インタラクティブAIのクォータ設計 | P2 | S |
| B-309 | インフラStage 3移行(PITR/監視強化/チェックシート対応) | P0 | M |

---

## 7. ロードマップ全体像

```
2026-07          2026-08          2026-09          2026-10〜      外販判断後
   │                │                │                │              │
   ▼                ▼                ▼                ▼              ▼
┌─────────┐  ┌──────────────┐  ┌──────────────────────┐  ┌───────────────┐
│ Phase 0 │  │   Phase 1    │  │       Phase 2        │  │   Phase 3     │
│ 即応     │─▶│ 束ねる        │─▶│ 足腰(性能・品質基盤)   │─▶│ 外販準備       │
│ セキュリ  │  │ 重複統合      │  │ 索引/キャッシュ/CI     │  │ マルチテナント │
│ ティ+導線 │  │ IA再編32→18  │  │ RLSテスト/E2E        │  │ 設定化/flags  │
└─────────┘  └──────────────┘  └──────────────────────┘  └───────────────┘
   ┃              ┃
   ┗━ B-007: Stage 1移行判断(¥7,000/月) ━━ Stage 2はP95計測後に判断 ━━ Stage 3は外販時
```

**運用ガバナンスの新設(推奨)**:
- 四半期「利用実態レビュー」: テーブル行数+画面アクセスで0利用機能を検知 → 廃止/定着を判断
- 機能追加時の「統合チェック」: 新画面提案時に既存の類似画面(§2.1)との統合可否を必ず検討
- VERIFICATION性能予算(取得<800ms/転送<300KB)の月次計測を継続

---

*本書はバックログの整理を目的とし、実装は含まない。各項目の着手時は該当IDを引用したWork Orderを `docs/exec-plan/` に起票することを推奨する。*
