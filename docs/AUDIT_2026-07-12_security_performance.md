# 全体監査報告（セキュリティ＋パフォーマンス / 2026-07-12）

> システム拡大（migration 0111・画面9本追加）を受けた全体チェック。**コード監査（並列2系統）＋Supabaseアドバイザリ（security 56件・performance 329件）を全件精査**し、重大所見は当日中に修正・本番適用・実データ検証済み。
> 対応migration: `0112`〜`0114`。目的:「サクサク動いて使いたくなるシステム」＝レスポンス最速の恒常化。

---

## A. 修正済み（本番適用・検証済み）

### セキュリティ
| # | 重大度 | 所見 | 修正 | 検証 |
|---|---|---|---|---|
| S1 | **HIGH** | **cron 2ルートが fail-open**：`CRON_SECRET`未設定だと `/api/cron/daily-digest`（物理削除trash_purge含む）と `/api/cron/xray-snapshot` を**誰でも無認可で実行可能** | 未設定なら503のfail-closedに統一＋タイミングセーフ比較（`src/lib/secure-compare.ts`）。batch系2ルートも同ヘルパーに統一 | コードレビュー |
| S2 | **HIGH** | **グローバル検索の越権**：`global_search` RPCがSECURITY DEFINERでテナントのみ絞り、**外部営業が担当外の全案件（金額付き）・顧客・リードを検索可能** | SECURITY INVOKERに変更しRLS（担当スコープ）を適用（0114） | 外部営業で実測: 16件ヒット・**担当外リーク0件**。オーナーは24件で機能正常 |
| S3 | **HIGH** | **anon（未ログイン）から実行可能なRPCが13個**（xray_metrics・dashboard_month_series・展示会系等）。0040/0041対策後に追加された関数で再発 | public+anonからEXECUTE剥奪（0112）。**再発防止**: schema defaultからPUBLIC実行権を恒久除去（以後の新規RPCは明示grantが必須） | advisors: anon系 13→**0** |
| S4 | **HIGH** | **新テーブルの閲覧スコープ回帰**：週報スナップショット（全社財務）・営業マン別週報（他人のナラティブ）がテナント全員=外部営業にも見えた | snapshots=管理ロール（can_view_all）限定、rep_reports=本人or管理ロール（0114） | ポリシー適用確認 |
| S5 | MED | 共有ナレッジ（knowledge/playbooks/content）を**外部営業が任意削除可能** | 削除=作成者本人or管理ロールに限定（0114）。※閲覧は「共有資産」として全員可を維持（意図どおり） | 同上 |
| S6 | MED | **顧客の担当（owner）変更がロール未チェック**（案件は管理職限定なのにaccountsだけ抜け） | アプリ側`canReassignOwner`チェック＋**DBトリガ**をaccountsにも装着（0114） | 同上 |
| S7 | MED | `searchApptLeadsAction`の`.or()`に**ユーザー入力を無サニタイズ連結**（PostgRESTフィルタ注入。他2箇所は対策済みでここだけ抜け） | 既存と同じメタ文字除去を適用 | コードレビュー |
| S8 | LOW | `addActivityAction`の`redirect_to`が**open redirect**可能 | 内部パス（`/`始まり・`//`除外）のみ許可 | 同上 |
| S9 | LOW | `is_project_mgr`のsearch_path未固定 | 固定（0112） | advisors解消 |

### パフォーマンス
| # | 影響度 | 所見 | 修正 | 効果 |
|---|---|---|---|---|
| P1 | **HIGH** | **RLSが行毎にauth関数を再評価**（auth_rls_initplan）— leads(11.6MB)・opportunities・meetings・activities・accounts・contacts・tasks・notifications等、**最も読まれるテーブル全部** | 22ポリシーを`(select auth.uid())`形式に書換（0113）。意味は完全同一（オーナー/外部営業の両視点でRLSスモークテスト済み・越権0） | 全クエリの行スキャンコスト削減。**該当WARN 35→13**（残りは低トラフィック表のみ） |
| P2 | MED | **RLSのEXISTS句が使うFKに索引欠落**：`opportunities(account_id)`・`meetings(owner_user_id/account_id)` — accounts/contacts等のRLS判定で毎回スキャン | 複合含む3索引を追加（0113） | 担当スコープ判定の高速化（データ増に耐性） |
| P3 | MED | **記事一覧が本文（body_md）全文を毎回転送**（一覧では有無しか使わない） | DB生成列`has_draft`を追加し一覧は本文非転送（0113＋`content-ideas.ts`） | 記事増加時のペイロード線形増を根絶 |
| P4 | MED | **メンバー名のためだけに約800KBのlite取得**：活動履歴・営業KPIの2ページ | 超軽量`getMembersLite()`（profiles+membershipsのみ、数KB）を新設し差替＋Promise.all並列化 | 両ページの転送量 ~800KB→数KB |
| P5 | LOW | playbooksのarchived除外がJS側 | SQL側`.neq()`へ | 微改善 |

---

## B. 現状の健全性（監査で「問題なし」を確認した項目）

- **XSS**: `dangerouslySetInnerHTML` 使用0件
- **シークレット漏えい**: クライアントバンドルへの非公開env参照0件。service roleはサーバー専用
- **Server Actionsの認可**: 全27ファイルで `requireCtx`系を通過。`tenant_id`をフォーム入力から書く箇所なし。ロール昇格経路はowner/admin限定で閉鎖
- **N+1/直列await**: 重大なものなし（全件取得系はPromise.all並列済み）
- **新画面のRLSスコープ**: `/app/review`・`/app/checklist`・`/app/analytics/winloss` は担当スコープで正しく動作
- **`getWorkspace()`(full 2.1MB)**: 直接利用ページ**0件**（ガードレール遵守。定義はデッドコード）

---

## C. 残課題（今回はスコープ外。優先順に）

| 優先 | 項目 | 内容 | 規模 |
|---|---|---|---|
| ★★★ | **重メモリ集計のRPC化** | leads全件集計（company/funnel/analysisタブ、11.6MB）・trends・winloss をSQL集計RPCへ。**データ10倍時の主要リスク** | 各M |
| ★★★ | **CRON_SECRETのVercel設定** | S1修正により**未設定だとcronが503で止まる**（安全側）。設定は元々の夜間バッチTODOと同一 | ユーザー操作 |
| ★★ | サーバーキャッシュ導入 | `unstable_cache`＋`revalidateTag`（workspace_lite・dashboard_metrics等の重RPC、短TTL） | M |
| ★★ | 残るliteページの棚卸し | 28ページ中、集計に使わないページ（settings/import系）を部分取得へ | M |
| ★★ | rechartsの遅延ロード | `next/dynamic`化で初回JS削減（チャート8ファイル） | S |
| ★ | multiple_permissive_policies（95件） | 同一テーブル複数許可ポリシーの統合。系統的リファクタのため別WOで | L |
| ★ | initplan残13件 | 低トラフィック表（comments/presets/attachments等）。まとめて機械的に | S |
| ★ | ナレッジ/型の検索SQL化 | 現在はJS部分一致（500件上限内は問題なし）。増えたらtsvector/pg_trgmへ | M |
| ★ | Leaked password protection | Supabaseダッシュボードで要ON（設定のみ・従来からの未対応） | ユーザー操作 |
| — | 多テナント化時の再監査ポイント | calendar/daily-digest/lead-intakeのservice roleクエリが単一テナント前提（tenant明示なし）。外販時に必須修正 | 記録 |

## D. 運用上の注意（今回の変更による挙動変化）
1. **`CRON_SECRET`をVercelに設定するまで、毎朝のSlackダイジェスト/月次xrayスナップは503で停止**します（無認可実行を許すより安全側に倒した。設定すれば即復旧）。
2. 週報スナップショット画面は**管理ロールのみ**データが見える（外部営業には空）。
3. 新規RPCを作るmigrationは、以後 `grant execute ... to authenticated` を**明示しないと動かない**（GUARDRAILS準拠が強制されるようになった）。
