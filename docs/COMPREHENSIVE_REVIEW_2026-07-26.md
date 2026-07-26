# CATORCE Sales OS 包括レビュー 2026-07-26

**対象**: `/home/user/LiteCRM`（Next.js 14 App Router + Supabase RLS / マルチテナント営業OS）
**実施範囲**: セキュリティ / UI・UX / 機能設計（重複・不足の再設計）/ 外販キラー機能 / 開発プロセス・Skills 整備
**手法**: コードベース全読み込み（118画面・約125テーブル・migration 172本・Server Action 50本・cron/API 28ルート）＋ **本番DB（catorce-sales-os）の実測**＋ Supabase セキュリティ勧告（76件）の突合。ドキュメント上の主張ではなく、コードと実データで裏取りしています。

> **このレビューの前提となるメタ所見**: 直近の docs（FEATURE_AUDIT 等）は migration 0138〜0145 時点の記述で、**コードはそれより約25本のmigration分先行**しています（PMO・プレゼンモード・Google Chat・ドキュメント基盤・マインドマップ・受信メール同期・Drive監査・AIヘルプRAG が文書化後に追加）。つまり「束ねるフェーズへ」という過去の提言の直後にも機能追加が続いており、**機能を作る速度が、統合・定着・品質保証の速度を上回っている**——これが全5領域に共通する根本課題です。

---

## 0. エグゼクティブサマリー

### 0.1 いま最優先で決めるべき3点（経営判断）

1. **セキュリティP1の即時修正**: 添付ファイル（`attachments`）が、オーナー境界もロール境界も無視して**同一テナントの全メンバーに閲覧可能**。特に採用候補者の書類（履歴書・オファー等）が営業ロールから越権ダウンロードできる設計欠陥。本番は現在 attachments 0行のため実害はまだ出ていないが、**この機能を使い始めた瞬間に個人情報漏洩が発生する**。利用開始・外販の前に必須修正。
2. **「作る」から「束ねて定着させる」への明示的シフト**: 約125テーブル中、**本番0行が約45個**（メール系・週次レビュー系・Sランク・ナーチャ・展示会WBS 等）。作った機能の3分の1以上が使われていない。新機能の追加を一時凍結し、重複統合（コメント8系統・通知4チャネル・見込み4系統・ドキュメント4系統）と0行機能の「廃止/隠す/定着」三択会議を先に行う。
3. **品質保証の足腰（CI・テスト・migration採番）の整備**: RLS/E2Eの自動テストがゼロ、CIにlint・migration重複チェック・シークレットスキャンが無く、migration番号は手動連番で**重複が7組**発生。外販の前提としてここが最大の穴。

### 0.2 領域別の要点

| 領域 | 状態 | 最重要アクション |
|---|---|---|
| セキュリティ | 前回監査(2026-07-12)の指摘は概ね修正維持。ただし**その後に追加した添付/ドキュメント/RAGにロール境界欠陥が新規混入** | P1 attachments_select の是正（本日中） |
| UI・UX | 118画面・多階層メニュー。実働7名に対し機能過多。動線切れ・空回り画面が散在 | IA再編の完遂（STEP1でメニュー非表示にしただけで画面は全存続） |
| 機能設計 | 記録系(コメント/報告/添付)を機能ごとにテーブル新設 → 重複が構造化 | ポリモーフィック統合の横展開＋0行機能の三択判断 |
| 外販キラー機能 | 「8SaaSが単一DBで連結」が唯一無二の強み。だが死蔵データ(名刺3,685・接点10,284)を価値化できていない | 「記録するSFA」から「動かすSales OS」へ＝AI参謀・ゼロ入力・経営ブリーフ |
| 開発プロセス | GUARDRAILS/VERIFICATION に Skill級の手順が書かれているのに `.claude/` が空 | 既存文書のSkills移植＋CI2ガード（採番・シークレット） |

---

## 1. セキュリティ

コード監査 + 本番DBのRLSポリシー実測 + Supabaseセキュリティ勧告76件で突合。前回監査 `docs/AUDIT_2026-07-12_security_performance.md` の指摘（cron fail-open・global_search越権・anon RPC・週報スコープ 等）は**概ね修正が維持**されており、XSS（`dangerouslySetInnerHTML` 0件）・SSRF（カレンダー取込はホスト限定）・OAuthトークン暗号化（AES-256-GCM）・秘密情報のハードコードなしは健全。**問題は前回監査以降に追加した機能に集中**しています。

### 1.1 [P1] 添付ファイルがテナント全員に閲覧可能 — HR候補者書類・他担当の商談資料が越権ダウンロード

- **対象**: `supabase/migrations/0070_phase5_meeting_ai_attachments.sql`（`attachments_select`）、`0138_hr_recruiting_expansion.sql`、`src/server/actions/attachments.ts`（`listAttachments`）
- **裏取り（本番RLS実測）**:
  - `attachments_select` の条件は `tenant_id IN (current_tenant_ids())` **のみ**。target のオーナーもロールも問わない。
  - 一方 `attachments_delete` は `... AND (uploaded_by = auth.uid() OR owner/admin OR (target_type='candidate' AND is_hr(tenant_id)))` と**候補者書類をHRに制限している**。つまり削除は守っているのに**閲覧は素通り**、という非対称が実在。
  - `listAttachments()` は `requireCtx()`（＝任意のログインユーザー）だけで、RLSが返した行に対し **service role で1時間有効の署名DL URL** を発行。
- **攻撃シナリオ**: 一般営業/外部営業ロールが Server Action を直接呼び `listAttachments("candidate", <候補者UUID>)` や `listAttachments("opportunity", <他担当案件UUID>)` を実行 → 履歴書・オファー・担当外の契約書/見積のダウンロードURLを取得。営業→HR、担当→非担当の二重の境界越え。
- **現状の実害**: 本番 `attachments` は **0行**（未使用）。よって現時点で漏洩している実データは無いが、**機能を使い始めた瞬間に顕在化する時限爆弾**。
- **対策**: `attachments_select` を target 種別でスコープ。candidate は `is_hr(tenant_id) OR uploaded_by=auth.uid()`、opportunity/account は該当 target の既存可視性（owner/`view_all`）を EXISTS で参照。`listAttachments` 側でも target 閲覧可否を明示チェックしてから署名URL発行（多層防御）。

### 1.2 [P2] documents 台帳・RAGチャンクがテナント全員に閲覧可能

- **対象**: `0166_documents_storage.sql`（`documents_select`=tenant限定）、`0169_ai_help_rag.sql`（`dc_select`=tenant限定、`search_document_chunks` もテナントのみ絞り）、`src/server/actions/documents.ts`、`assistant.ts`
- **裏取り**: 本番RLS実測で `documents_select` / `dc_select` とも条件は `tenant_id IN (current_tenant_ids())` のみ。オーナー/ロール境界なし。唯一のアクセス制御は `index_status='excluded'` の粗いフラグ運用。本番 **documents 5行（テナント全開放中）/ document_chunks 0行（RAG未索引）**。
- **攻撃シナリオ**: 一般営業がAIヘルプで「〇〇社の見積金額」「役員報酬」等を質問 → excluded 付け忘れの HR/財務/契約系ドキュメント本文が回答＋Driveリンク付き出典として返る。機密性が「excluded 付与漏れゼロ」という運用前提に全依存。
- **対策**: documents に category ベースの可視性（HR/finance/契約はロール制限）。RAG RPC 内で呼び出しユーザーのロールで category フィルタ。未分類はデフォルト索引対象外（安全側）に。

### 1.3 [P2] lead-intake にレート制限がない — スパム/メール増幅の踏み台

- **対象**: `src/app/api/lead-intake/route.ts`
- **内容**: 公開エンドポイント。認可は共有秘密 `LEAD_INTAKE_SECRET`（HPのクライアント側フォームに埋め込む運用だと実質公開）。ハニーポット＋任意reCAPTCHAはあるが**レート制限なし**、CORSは既定 `*`、有効メール入力時に**任意アドレスへ自動返信メールを送信**。
- **攻撃シナリオ**: トークンを得た攻撃者が大量POST →（1）leads/通知/Slack のフラッディング（2）被害者アドレスを入れて**自社SMTPから被害者宛に自動返信を大量送信＝メール増幅・送信ドメインのレピュテーション毀損**。
- **対策**: IP/トークン単位のレート制限を必須化、本番でreCAPTCHA/Turnstile必須、自動返信の同一宛先頻度制限、CORSを許可オリジン固定、トークン比較を `secureCompare` に。

### 1.4 [P2] ICSカレンダーフィードが単一共有トークン — 全担当のアポ情報がURL1本で漏洩

- **対象**: `src/app/api/calendar/route.ts`
- **内容**: `?token=CALENDAR_FEED_TOKEN` をクエリ検証。`owner` は絞り込みフィルタに過ぎず、未指定なら**テナント全担当のアポ（顧客名・案件名・担当者名）を最大500件返す**。トークンは全社共有・無期限でURLに載る（ログ/履歴/リファラに残留）。
- **対策**: per-user 発行・失効可能なフィードトークン（`user_calendar_feeds` と同方式）へ変更し、当該ユーザーの可視範囲に限定。トークンはパスセグメント化＋ローテーション。

### 1.5 中〜低リスク（P3、まとめて是正推奨）

| # | 項目 | 対象 | 対策 |
|---|---|---|---|
| P3-a | OAuth state が userId の決定論的HMAC（nonce/TTL/単回性なし、`MAIL_CRED_SECRET` を暗号鍵と兼用） | `src/lib/google-oauth.ts` | ランダムnonce＋短期TTL＋サーバ保存で単回検証、`OAUTH_STATE_SECRET` 分離 |
| P3-b | cron 2本が timing-safe 比較未使用（標準逸脱） | `cron/models/[file]`、`cron/recordings/audio` | `checkBearer` に統一 |
| P3-c | 認可コンテキストが `getSession()` 依存（Supabase非推奨） | `src/lib/session.ts` | `getUser()`/`getClaims()` に切替 |
| P3-d | `/api/version` が未認証でcommitメッセージ先頭120字を露出 | `api/version` | SHA/branchのみ、またはログイン必須 |
| P3-e | セキュリティレスポンスヘッダ未設定（CSP/HSTS/X-Frame-Options） | `next.config.mjs` | `headers()` で付与 |
| P3-f | `/api/warm` が未認証で service role によりDBアクセス | `api/warm` | anonクライアントping、またはCRON_SECRET保護 |
| P3-g | Sentry に PII スクラビング(beforeSend)なし | `sentry.*.config.ts` | `beforeSend` でマスク、`sendDefaultPii:false` 明示 |
| P3-h | `createMemberAction` の role をallowlist未検証・初期PW平文で初回強制変更なし | `src/server/actions.ts` | role allowlist検証、招待リンク方式 or 初回PW強制変更 |

### 1.6 Supabaseセキュリティ勧告（本番実測76件）

- **anon（未ログイン）から実行可能な SECURITY DEFINER 関数7個**: `reset_demo_tenant_guarded` / `seed_demo_extras` / `enter_presentation_mode` / `exit_presentation_mode` / `is_presentation_active` / `apply_sales_ranks` / `sync_next_action_task`。**関数本体を精査した結果、いずれも冒頭で `auth.uid()` の null チェックやメンバーシップ確認を行っており致命的ではない**（例: `enter_presentation_mode` は非デモの実メンバー限定、`reset_demo_tenant_guarded` はデモメンバー限定）。ただし `apply_sales_ranks(p_tenant)` は引数テナントの検証が弱く、`sync_next_action_task` はトリガー関数で直接呼び出し想定外。GUARDRAILS方針どおり **anon への EXECUTE を revoke** して防御を一段固めるべき。
- **RLS有効・ポリシー0件**: `public_shares`（本番2行）/ `share_view_events`（753行）。**現在このテーブルへの通常アクセスは全拒否**（service role経由のみ動作）。共有ビュー機能の権限モデルを明示ポリシーで固めるか、機能廃止を判断。
- **Auth: leaked password protection が無効**（ダッシュボード設定でON推奨）。
- 拡張（`pg_net`/`vector`/`pgroonga`）が public スキーマ配置、`block_demo_writes` の search_path 可変 — いずれもWARN、余力で是正。

### 1.7 健全性を確認した項目（問題なし）

Google Chat/Pub-Sub webhook検証（RS256強制・alg混同不可・fail-closed）、OAuthトークン暗号化（AES-256-GCM）、SSRF防御（`calendar.google.com` の `/ical/` 限定）、track/c のオープンリダイレクト対策（DB由来＋`^https?://`限定）、プレゼン/デモ分離（`block_demo_writes`トリガ）、mindmaps の本人限定RLS（0169）、秘密情報の非混入。

### 1.8 前回監査（2026-07-12）からの残存

- S1〜S8 の主要指摘は**修正維持**。
- 「多テナント化時の再監査」で挙がった calendar/daily-digest/lead-intake の単一テナント前提は**据置**（本レビューの1.3/1.4で顕在化）。多テナント外販の前に必須。
- **新規欠陥**: attachments/documents/RAG のテナント全開放（0070/0138/0166/0169）は前回監査後に増加。新テーブル追加時のRLSスコープ精査が candidate添付・ドキュメント台帳・RAG に及んでいなかった。→ **後述の `security-audit` / `add-migration` Skill でこの観点を定型化する**。

## 2. UI・UX

`src/app/app` 118ページ・`src/components` 179コンポーネント・ナビ/データ取得層を全読み込み。IA再編計画 STEP1〜2 の多く（サイドバー絞り込み、`analytics/lost`→`winloss` リダイレクト、`forecast/pipeline` タブ接続、モバイルボトムナビ、共通loadingスケルトン）は**実装済み**を確認した上での残課題です。**中心は「新規設計より計画の完遂」**——残る問題の大半が IA再編STEP3・改善提案B の未実施項目と一致します。

### 2.1 最優先（P0）

**[P0] 週次レビュー画面（最重要画面）が完全な読み取り専用**
- 対象: `src/app/app/reviews/weekly/page.tsx`
- 約10ブロックを表示するが `<form>` が1つもない。「今週の施策（会議で決めること）」は静的な `<li>` 6行で、決めた打ち手を登録する導線がゼロ。READMEが「確認で終わらせず打ち手を決める会議画面（最重要）」と謳う画面が「見るだけ」に退行している。
- 改善: 各危険案件・停滞案件の行に「対策を登録」ボタン（既存タスク/次アクション作成の再利用）。施策リストをeditableにして翌週に消化確認できる形へ。

**[P0] アポ登録→案件が「未完成」で生成される二度手間**
- 対象: `appointment-register-form.tsx`、`server/actions/appointments.ts`、`opportunities/new/page.tsx`
- アポ登録はヨミ=4.アポ固定で案件を作るが、案件の必須項目（予測/受注見込み時期/次回アクション）が未設定のまま。主要入口で作った案件が即「危険案件（次AC未設定）」として検知され、余計な警告と再入力が発生。
- 改善: 保存時に「初回商談日=次回アクション」を自動設定、受注見込み月候補もその場で1タップ選択。

**[P0] 中核入力フォームがモバイルで崩れる**
- 対象: `opportunities/new/page.tsx`・`opportunity-detail-view.tsx`・`today/quick-log-form.tsx`（**モバイル特化画面なのに `grid-cols-2` 固定**）・`customer-picker.tsx`
- 「商談後5分以内に記録」「外出先で案件を起こす」という運用ルールの実行手段がスマホで実質使えない。ボトムナビという良い土台が活きていない。
- 改善: 該当グリッドを `grid-cols-1 sm:grid-cols-2` へ一括修正（機械的に直せる）。

**[P0] 94/118ページが force-dynamic、キャッシュ戦略ゼロ**
- 対象: `src/app/app` 全体（force-dynamic 94ページ）、`unstable_cache`/`revalidateTag` 使用0箇所
- 部分取得は前進（2.1MB→約800KBのRPC化）したが、**30ページが依然 `getWorkspaceLite`（accounts+opportunities全件 約800KB）を毎遷移で取得**、マスタ系（products/lead_sources/campaigns）すらリクエスト跨ぎキャッシュがない。件数増加とともに「レスポンスが悪い」不満が再燃する構造。
- 改善: マスタ系を `unstable_cache`（タグ付き）へ、一覧系はサーバーサイドページングへ、参照だけの分析ページは `revalidate=60` で十分。

### 2.2 情報設計・フロー（P1）

- **[P1] サイドバー再肥大**（`nav-config.ts`）: 営業ロールで29項目（IA目標23に対しメール・AIヘルプ・AI-PMO・ヘルプ・自動化の追加で超過）、owner/adminは約43項目でスクロール常態化。→ 追加機能は既存ハブへ吸収（「AIヘルプ」が顧客グループ配下なのは不自然、ヘルプ系へ）。
- **[P1] 118ページ中メニュー到達は約40**、分析の入口が4つ（分析ハブ/レントゲン/AI-PMO/経営レビュー）に分散。→ 分析ハブに「よく使う/最近見た」を出し入口を1つに寄せる。
- **[P1] ヨミ編集経路が10箇所・選択肢が10択/8択/7択に分裂**（`opp-inline.tsx`・`opp-paginated-table.tsx`・`opportunities/new`・`opportunity-detail-view.tsx` ほか）。変更理由を求めるのは週報2経路のみで他8経路は無言変更可 → **ヨミ変更履歴の分析データが穴だらけに**。「ヨミが最重要」という運用の根幹で操作が画面ごとに違う。→ S3-2（共通ヨミ編集ドロワー）前倒し、選択肢は `constants.ts` 単一関数から生成、決着系変更時は全経路で理由入力。
- **[P1] 必須マーク「*」と実装の乖離**（`required` 属性ゼロ）、金額入力3種・確度4表現の混在。→ `required`付与＋送信前検証、金額は`MoneyInput`統一、確度は「ヨミ連動（自動）/担当者予測（手動）」に整理。
- **[P1] 保存フィードバックが4系統に分裂しトースト機構が存在しない**（案件作成の成功表示ゼロ、失敗は`alert()`、`useOptimistic`は0箇所）。→ 軽量トースト（aria-live付き）1つで全経路統一、`alert()`廃止。
- **[P1] 共通UIが薄くテーブル/カレンダーが二重実装**（`opp-table.tsx` は到達不能なデッドコード、`components/ui`にButton/Drawer無し）。→ 到達不能コード削除（リスクゼロ）、Button/Drawerを`components/ui`へ。
- **[P1] Accent Orangeのコントラスト不足**: 白文字 on `#F59A2A` は約2.4:1でWCAG AA（4.5:1）に大きく不適合。Teal on白も約4.1:1、`text-ink/40`の補助テキストも不足。→ オレンジボタンは文字を濃色化 or 背景を`#D97706`級へ、情報テキストに40%以下不透明を使わない。
- **[P1] 週次レビュー・週報のモバイル閲覧が困難**（`lg:`のみでmd以下は超長スクロール、MiniTableに`overflow-x-auto`なし、週報テーブルは`minWidth:1180`固定）。

### 2.3 中〜低（P2/P3、抜粋）

- URL・名称の紛らわしい対: `/app/review`（AI確認キュー）vs `/app/reviews`（週次）、営業軸の画面が3系統分裂。
- 予測入力が行単位保存＋200件打ち切りで月次棚卸しが苦行 → 一括コミット＋差分再取得。
- 売上予測と来期計画（`revenue_forecasts`）の二重計上に重複警告なし → 案件リンクで除外。
- 破壊的操作の確認が`confirm()`依存28箇所、`not-found.tsx`なし、ドロワーにフォーカストラップ/Escなし（aria-liveはアプリ全体で1箇所）。
- 極小フォント（`text-[10px]`）多用 → 情報テキストは12px下限。
- ヘルプ資産は良質だが導線が「設定」グループに埋没、AIヘルプは「顧客」配下で発見性ほぼゼロ → トップバーに「?」常設。

### 2.4 クイックウィン10選（工数小・効果大）

1. 案件作成の成功フィードバック: `server/actions.ts` の redirect に `?saved=1` 付与（1行）。
2. アポ登録に `required` 付与（属性追加のみ）。
3. モバイルのグリッド修正: 固定 `grid-cols-2/3` に `sm:` 追加。商談後5分入力がスマホで復活。
4. ヨミ選択肢の単一ソース化: 10択/8択/7択を `constants.ts` の1関数へ集約。
5. 週次レビューの MiniTable に `overflow-x-auto`、ブロックの `lg:`→`md:`。
6. `rep-opp-drawer` の金額入力を `MoneyInput` に統一。
7. `opp-inline.tsx` の `alert()` をバナーに置換。
8. 週次レビューの危険案件行に「対策をタスク登録」ボタン（既存アクション再利用のみ）。
9. 到達不能な `opp-table.tsx`・旧 `appointment-calendar.tsx` の削除（ユーザー影響ゼロ）。
10. トップバーに「?」ヘルプアイコン常設（最も安い定着施策）。


## 3. 機能設計 — 重複・不足の再設計

118画面・約125テーブルの全マップを作成し、コード上の使われ方と本番の行数で「正/従」を判定しました。全マップは付録Aに、ここでは判断と方針を示します。

### 3.1 重複（統合方針つき）

既に**筋の良い統合の前例がコード内にある**——「次アクション＝tasksが正（opportunities列はキャッシュ、0135/0162）」「HP問合せ＝leadsが正（inquiryタブ/媒体タグに一元化、0159-0161）」「ドキュメント＝documentsリンク台帳が正（0166）」。この考え方を未整理領域へ横展開するのが再設計の軸です。

| # | 重複領域 | 系統数 | 正とすべきもの | 統合方針 |
|---|---|---|---|---|
| B-1 | ドキュメント/ファイル | 4（attachments / documents / knowledge添付 / proposal_versions ＋URL文字列カラム） | **documents（Driveリンク台帳）** | attachments を documents の storage-provider の一種として吸収、knowledge/proposal は外部キー化、`opportunities.proposal_doc_url` 等の文字列カラムは移行して廃止 |
| B-2 | メモ/ノート/コメント | 8（opportunity/lead/business_card/task/pmo_report_comments ＋ account_notes/meetings/activities） | **ポリモーフィック `comments(target_type,target_id)` 1本** | コメント5系統を統合（@メンション・通知の実装も1回で済む）。account_notes の AIリサーチは構造化スコア持ちで別扱い、meetings/activitiesは「記録」で対象外と明文化 |
| B-3 | 人物・企業DB | 3（leads 8,415 / business_cards 3,685 / contacts 168） | **contacts を正** | leads/business_cards は入口ステージとし contacts への昇格・逆リンクを必須化。名寄せ(dedupe)を cards/contacts へ拡張。**名刺→リード昇格の導線はコード上不在**（競合マップの記述と乖離）— 新規実装対象 |
| B-4 | リード vs HP問合せ | 統合**済み**（良い例） | leads | 現状維持。`/api/lead-intake` の単一テナント前提だけ外販時に解消 |
| B-5 | タスク vs 各種アクション | 5（tasks / next_action / multi_next_actions / mtg_actions / expo_tasks） | **tasks（origin列で発生源区別）** | 0135/0162で商談系は一本化済み。残る mtg_actions は `tasks(origin='exec_action')` へ、expo_tasks は task_projects テンプレートへ吸収 |
| B-6 | 報告系 | 5（activities / weekly_rep_reports / weekly_reviews / project_weekly_reports / pmo_reports）＋work_entries | **手入力は activities+work_entries に限定、週次まとめは自動生成(pmo)へ** | pmo_reports は自動生成の「消費者」で人の週報とは役割が違う。weekly_reviews/weekly_kpi_* は本番0行で廃止判断 |
| B-7 | 通知チャネル | 4（アプリ内ベル / Slack / Google Chat / メール）×個別実装 | **notification service 1レイヤー ＋ Chat を本命に** | daily-digest が Slack と Chat の両方へ送る過渡状態。automation_rules(0142)を受け皿に「イベント→service→チャネル選択」へ集約。ユーザー別通知ON/OFF設定を新設 |
| B-8 | 予測 | 4（forecast画面 / revenue_forecasts / delivery_forecasts / dashboard6ヶ月）＋死蔵forecast_snapshots | 見込み1テーブル＋view で用途分離 | revenue_forecasts(営業版)とdelivery_forecasts(原価版,0165)が新たに概念重複。加重計算ユーティリティを1本化、確度スケール 0-100/0-1 混在を統一 |
| B-9 | 監査ログ | 2（audit_logs 変更履歴 / audit_events 操作証跡） | 役割分担を文書化し**閲覧UIは settings/audit に統合** | 意図的分離だが保持期間・権限が別々。役割を明記 |

### 3.2 不足機能（優先度つき）

**まず「もう実装済み」を docs から消す**: グローバル検索・ゴミ箱・変更履歴・重複マージUI・通知ベル・添付・CSVエクスポート・Webフォーム→リード・メール送信/開封計測/シーケンス・**受信メール同期（docsでは「意思決定段階」だが0146+cronで実装済み）**・ガント/依存関係・エラーバウンダリ は完了。

| 優先 | 不足機能 | 根拠 |
|---|---|---|
| P0 | **自動テスト・CIゲート・RLS分離テスト** | vitestは純関数のみ。E2E/RLS/ページスモークの自動化ゼロ。全docsが最重要指摘で未着手 |
| P0 | **マルチテナント外販の足腰** | `tenant_settings` はテーブルだけでコード参照0、cron/バッチが単一テナント固定、provision_tenant・feature flags なし |
| P1 | **一括メール送信の到達管理・コンプラ** | `email_events` はテーブル作成のみでコード参照0＝バウンス/配信停止(オプトアウト)管理なし。特定電子メール法の配信停止リンクも見当たらず、シーケンス運用のコンプラリスク |
| P1 | **権限の細分化** | external_sales の可視範囲仕様が不在、項目レベル権限・権限マトリクス文書なし |
| P1 | カスタム項目 | スキーマ固定（外販ブロッカー） |
| P1 | 通知センター統合＋ユーザー別通知設定 | B-7、通知ON/OFF画面なし |
| P2 | 公開API/Webhook（アウトバウンド）、レポートビルダー、名刺OCR、会議録画取込、リソースキャパシティ計画、請求書発行・入金消込 | 競合マップ §で未対応と明記 |
| P3 | MFA/レート制限/漏洩PW保護ON、活動CSV、モバイルネイティブ通知、i18n | AUDIT指摘のまま |

### 3.3 死に機能・宙に浮いた機能（本番実測）

**三択会議（廃止 / 隠す / 定着施策）を保留したまま新機能が積み増されている**のが構造問題。

- **コード参照ゼロ（テーブルだけ）**: `forecast_snapshots`（予測精度検証の残骸）、`email_events`（開封計測は別実装）、`invitations`。→ 廃止候補。`tenant_settings` は外販の要なので温存。
- **本番0行だが画面あり（＝定着漏れ）**: srank_*（3画面）/ account_nurture・nurture_touches / sales_playbooks / weekly_reviews・weekly_kpi_* / case_studies / expo_projects・tasks・staffing / goals・task_portfolios / proposal_versions / solution_packages。**opportunity_products が空 → product-roi分析画面が空回り**。
- **画面はあるが導線がない**: `/app/analytics/lost` は**アプリ内リンク0の完全孤立**（失注2画面統合が未完）。`stage-flow`・`compare`・`exec/calc`・各import系は参照1件のみ。
- **IAで意図的にナビ非表示**: checklist / srank / nurture / playbooks / content / reviews/snapshots / reviews/yomi-history（STEP1で隠しただけで画面は全存続＝メンテ負債は残る）。

---

## 4. 外販キラー機能 — 業務を広く定義した立案

### 4.1 戦略ポジション

競合マッピング(docs)＋本番運用データから、**唯一無二の構造的差別化は「名刺→リード→商談→ヨミ→案件→粗利→深耕 が単一DBで連結」**。専業SaaS8個分を機能数で追うのではなく、この連結でしかできない体験を売る。そして運用データが示す現場の痛点は明確——**オープン商談548件のうち219件（40%）が14日以上放置**。「記録するSFA」は既にあり、次は「**動かすSales OS**」。

### 4.2 キラー機能候補（優先度順）

| # | 機能 | 中身 | 既存素材 | 外販での訴求 |
|---|---|---|---|---|
| **K-1** | **AI営業参謀「今日の3手」** | 毎朝、各営業に「今日やるべき3件」（放置商談・ヨミ降格予兆・フォロー期日）を根拠つき提示、1タップで次アクション登録/メール下書き生成。夜間バッチで従量課金ゼロ | sales_alerts / risk.ts / tasks 連携 | 「SFAは記録するだけ、Sales OSは動かす」。放置40%を直接潰す |
| **K-2** | **ゼロ入力SFA（商談ボイス→自動CRM）** | 商談後30秒喋る/録音アップ→夜間AIが活動記録・次アクション・ヨミ変更案・議事録を生成、翌朝「承認キュー」で1タップ反映 | meeting_recordings / batch/meeting-summary / 録音Drive保存(P1.6) | 中小の最大失敗要因「営業が入力しない」を解消＝導入障壁の除去そのもの |
| **K-3** | **経営ブリーフ「社長の5分」** | 週次で着地予測・ギャップ・原因・今週の意思決定3つをA4一枚に自動生成しPDF/Chat配信 | forecast / xray_metrics / weekly snapshot / daily-digest cron | オーナーはCRMを開かない。「開かなくても届く」 |
| **K-4** | **案件収益ガード（粗利アラート）** | 受注後の案件で計画粗利率を下回る予兆（稼働超過ペース）を検知通知 | project_cost_months / work_entries / project_profit_reviews（アラート化のみ未） | 商談→案件→粗利の一気通貫データの収益化。PSA系と「営業一体」で差別化 |
| **K-5** | **顧客カルテ360（訪問前ブリーフ）** | アカウントを開くと過去商談・名刺・会話・粗利・関係者マップ・次の一手をAI要約。翌日訪問先のカルテを前夜自動生成しChat配信 | business_cards 3,685 / touchpoints 10,284 / person_engagement 8,066（**いずれも死蔵**） | 眠っているデータを価値化。他社はデータが無くて作れない |
| K-6 | 乗り換えパッケージ（Import OS） | SF/HubSpot/kintone/Excel＋名刺画像の一括取込ウィザード＋重複マージ＋初期テンプレ | lead_import_batches / merge系関数 | 外販商談で必ず聞かれる「移行どうするの」への回答＝キラー導入体験 |
| K-7 | 多拠点ロールアップ | グループ会社・代理店網の複数テナントを束ねて経営数値をロールアップ | マルチテナント設計 | 外販の内部要件を「売れる機能」へ転換 |

### 4.3 業務を広く定義した拡張軸（中期）

- **業種OS化**: 研修業特化テンプレ（講師アサイン×案件原価×セミナーフォロー）を「垂直パッケージ」として展開。汎用CRMではなく「研修会社のためのSales OS」。
- **リソース×採用の接続**: talents/candidates を「講師リソース計画」に接続 → PSA系で欠落しているリソースキャパシティ計画（来月誰が空くか）を、採用と一体で提供。
- **バックオフィス接続**: billing_schedules を起点に請求・入金消込へ。

### 4.4 追わない（非推奨）

汎用ガントの高度化・Wiki・CTI など専業SaaSの土俵で、連結価値に寄与しない機能数競争。kintone的ノーコード基盤の真正面代替も思想差が大きく非推奨。

<!-- SKILLS_SECTION -->
## 5. 開発プロセス・Skills 整備

### 5.1 現状（実態）

- コミット139本の作者は Claude 92 / オーナー 47。実装のほぼ全てが Claude Code セッションで行われ、オーナーはマージ・検収役。
- **`.claude/` が存在しない**（skills/settings/hooks/CLAUDE.md いずれも無し）。一方 `docs/exec-plan/GUARDRAILS.md`・`VERIFICATION.md`・`runbooks/` に**Skill級の手順が既に書かれている**——RLS必須3点セット、SECURITY DEFINER の revoke 手順、品質ゲートG-1〜G-9、夜間バッチ手順。Claude Code が自動で読み込む入口が無いだけ。
- CI（`.github/workflows/ci.yml`）は typecheck→vitest→build のみ。**lint・migration重複チェック・シークレットスキャンが無い**。テストは純ロジックvitest26本のみでE2E/RLSなし。
- migration は手動連番で**重複7組**（0088/0127/0162/0166/0167/0168/0169）。並行Claudeセッションが同番号を採る構造問題で、直近ほど悪化。
- **`docs/DEPLOY.md` に本番オーナーの平文初期パスワードが記載**（別途ローテーション推奨）。

### 5.2 (A) Skills化すべき作業

`.claude/skills/<name>/SKILL.md` として、コミット履歴の反復作業に基づき提案（優先度順）。

| # | Skill | トリガー | 骨子 | 自動化度 |
|---|---|---|---|---|
| 1 | **add-migration** | DB変更を伴う実装（最頻出） | `ls migrations`＋`list_migrations` の両方で次番号確定（重複再発防止）→ RLSポリシー4本・`set search_path`・SECURITY DEFINER の `revoke from public,anon`（1.1/1.6の再発防止）→ apply＋即コミット → `get_advisors(security)` ERROR=0検証 | 加算的DDLは全自動、破壊操作は人承認必須 |
| 2 | **verify**（品質ゲート） | コミット前・WO完了時 | typecheck＋test＋build → get_advisors → 13ページスモーク → 性能予算（<800ms/<300KB） → 完了報告テンプレ出力 | 全自動 |
| 3 | **security-audit** | 監査依頼・P0後・月次 | get_advisors全件 → RLSスコープsweep（**target/ロール境界チェックを本レビュー1.1/1.2を教訓に定型化**）→ anon EXECUTE権限sweep → デモ分離検証 → docs内シークレットgrep → P0/P1/P2レポート | 検出は全自動、修正は人承認 |
| 4 | **new-feature** | 新機能・新ページ | 設計メモ → スキーマ差分照合（既存列があれば新設禁止）→ add-migration → 実装 → verify → 段階リリースの切れ目提示 | 実装は全自動、スコープと旧ルート廃止は人判断 |
| 5 | **temp-diagnostic** | 本番でしか再現しない不具合 | トークン認可付き診断EP追加 → 検証 → **撤去コミットまで1セットでTODO化**（履歴上6サイクルの撤去忘れ防止） | 全自動 |
| 6 | **demo-tenant-refresh** | プレゼン前・デモ拡充 | デモシード投入 → **全RLSゲートで実データ分離を検証**（過去の実データ露出のリグレッション）→ 閲覧専用確認 | シードは自動、分離検証は人レビュー |
| 7 | **release-deploy** | 本番反映・環境変数変更 | DEPLOY.md手順 → `/api/version` でSHA一致確認 → スモーク → Redirect URLs確認 → ロールバック手順提示 | デプロイGoは人、前後検証は自動 |
| 8 | **analysis-report** | 「〜を分析/設計して」 | `docs/<TOPIC>_YYYY-MM.md` 命名、実測値必須（「動くはず」は不合格）で構成 | 全自動 |
| 9 | **help-docs-update** | ONBOARDING/MANUAL更新 | 編集 → `node scripts/build-help.mjs` 実行（忘れ防止）→ 実顧客名・URL・認証情報の混入grep（P0情報漏洩の再発防止） | 全自動 |
| 10 | **nightly-batch** / **weekly-usage-review** | Routine起動（03:00 / 月曜08:00 JST） | 既存runbookをSKILL.md化。batch_job_settings確認 → ingest API実行 | 全自動 |

補足: リポジトリ直下に **CLAUDE.md** を新設し GUARDRAILS/VERIFICATION への必読リンクを置く（現状Claude Codeが自動で読む入口が無い）。

### 5.3 (B) 開発フロー改善

1. **migration採番（最優先）**: Supabase標準のタイムスタンプ命名 `YYYYMMDDHHMMSS_name.sql` へ移行（衝突が原理的に消える）、またはCIに重複検出 `ls migrations | sed 's/_.*//' | sort | uniq -d`（非空でfail）を追加。既存重複は適用順を台帳化して凍結。
2. **CI強化**: lint / migration重複 / GUARDRAILS静的チェック（新規migrationに `enable row level security` を含むか、`getWorkspace` 新規利用grep）/ gitleaks等シークレットスキャン（DEPLOY.mdの平文PWは即削除＋ローテーション）。
3. **ブランチ戦略**: `main` を本番に昇格し claude/* → PR → CI必須 → マージ。Vercelプレビューで検収。
4. **テスト戦略**: 13ページスモークのPlaywright自動化、RLSのSQLテスト（認証コンテキスト切替手順はGUARDRAILSに既出）、`/api/batch/*` の契約テスト。
5. **レビュー手順**: VERIFICATION完了報告テンプレを `.github/PULL_REQUEST_TEMPLATE.md` に転記し「実測値・SQL結果の無い報告は差し戻し」を機械運用。

### 5.4 (C) 人間とClaudeの分担モデル

- **人間が必ず判断**: 破壊的DB操作の承認 / 本番デプロイGo・ロールバック / 要件・優先度・スコープ決定 / ユーザー検収と差し戻し / 外部コンソール操作（Google Workspace・Vercel・Supabase・DNS）/ デモ実データ分離の最終確認。
- **Claudeに任せる**: 実装・加算的migration・テスト・品質ゲート実行と実測値付き報告 / 分析・設計・監査レポート / ヘルプ資料ビルド / 夜間バッチ・週次レビュー（Routineで自走）/ 一時診断の追加〜撤去 / デモデータ生成・リグレッションスモーク。

---

## 6. 「他にもっとないか」再チェックの結論と実行順

網羅性のため、5領域を横断して再点検した結果、**新機能を止めて足腰を固めるフェーズ**という結論は全領域で一致します。推奨実行順:

1. **今日**: セキュリティP1（attachments_select）修正＋P2（documents/RAG、lead-intakeレート制限、calendarトークン）。DEPLOY.mdの平文PW削除＋ローテーション。
2. **今週**: `.claude/` にSkills移植（add-migration / verify / security-audit を最優先）＋CIにmigration重複・シークレットスキャン追加。0行機能の三択会議。
3. **今月**: 重複統合の第一弾（コメント統合 or 通知統合）＋失注2画面など孤立画面の整理。RLS/スモークの自動テスト着手。
4. **四半期**: キラー機能K-1（今日の3手）とK-2（ゼロ入力SFA）を外販の看板として実装。tenant_settings/feature flags の外販足腰。

---

## 付録A. 機能全マップ（画面 × API/Action × テーブル）

主要領域のみ抜粋（全118画面・約125テーブルの完全版はコード参照）。「正/従」判定と本番行数を併記。

**ホーム/実行系**: dashboard / today（モバイル動線）/ review（AI確認キュー）/ checklist（ナビ非表示）/ tasks（Asanaクローン: projects/portfolios/goals/meetings/reports）/ activities / mindmaps（管理者限定, mindmap_nodes 1,811行）

**案件(SFA)系**: appointments/new → opportunities（1,051行, オープン548・14日放置219）/ opportunities/import（Notion CSV）/ reps / forecast（+pipeline）/ targets / work（稼働報告）/ projects（原価・稼働承認, 管理職）

**顧客系**: accounts（837行）/ contacts（168行）/ business-cards（3,685行, 7/14以降新規0）/ leads（8,415行, inquiriesタブでHP問合せ統合）/ srank（0行, ナビ非表示）/ nurture（0行, ナビ非表示）/ knowledge・playbooks（0行）・content / email（templates/compose/history/sequences/analytics: **email_messages等ほぼ0行・未運用**）/ assistant（AIヘルプRAG, document_chunks 0行=未索引）

**分析・レビュー系**: analytics ハブ＋16画面（lost はリンク0の孤立）/ xray（営業レントゲン）/ exec ＋9サブ / reviews（weekly/rep/snapshots/yomi-history, weekly_reviews 0行）/ pmo（AI-PMO, 23行・直近活発）

**BO/HR/設定/自動化**: bo 7画面（subsidies/expos等, expo_* 0行）/ hr（openings/candidates/talents）/ settings（audit/drive-audit/duplicates/trash）/ automation（automation_rules 1行）/ chat（Google Chat, subscriptions 0行）/ calendar（ICS）/ recordings（録音→文字起こし, 3行）/ batch（夜間AI）/ presentation（デモモード）

**運用実態の要点（本番実測 2026-07-26）**:
- 2テナント（カトルセ本番 / アークサイド・デモ）。memberships 26名だが**直近30日の実操作者は実質7名**、sales_rep 5名は全員未ログイン。
- 最活発は tasks（直近7日263件）。opportunities はオープン548件中**219件（40%）が14日以上未更新**。
- business_cards 3,685・touchpoints 10,284・person_engagement 8,066 は一括投入後**ほぼ死蔵**（→ キラー機能K-5の原資）。
- 約45テーブルが本番0行（メール系・週次レビュー系・Sランク・ナーチャ・展示会WBS 等）。

---

*本レビューは調査・立案のみで、コード修正・スキーマ変更は行っていません。次アクション（P1修正・Skills作成・重複統合）はオーナーの優先順位判断を待って着手します。*

