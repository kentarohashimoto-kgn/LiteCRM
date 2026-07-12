# freee 連携 機能設計（2026-07）

> **目的**: CRM（CATORCE Sales OS）と **freee会計 + freee見積・請求** を連携し、
> 「見積・請求の転記ゼロ」「検収→請求の抜け漏れゼロ」「予実（CRM予測 vs 会計実績）の自動突合」を実現する。
> **前提**: 既存の通知基盤（朝cron/ベル/Slack）・`billing_schedules`・`projects`・RLS基盤・監査トリガー（`fn_audit_row`）を最大限再利用する。
> **会計年度**: 7月開始・6月決算。

---

## 0. 確定した方針（ヒアリング結果 2026-07-12）

| # | 論点 | 決定 | 設計への反映 |
|---|---|---|---|
| 1 | 連携範囲 | **freee会計のみ**（見積・請求も freee会計のAPIを使用。freee販売・人事労務は対象外） | F-1〜F-4を対象。見積/請求は freee会計の見積書・請求書APIを利用 |
| 2 | 請求タイミング | **検収時に請求** | `billing_schedules` に検収状態を追加。**検収記録をトリガに請求書「下書き」を生成** |
| 3 | マスタの正 | **既存マスタ=freeeが正／今後の新規データ=CRMが正**。ただし**名称変更は都度確認**（サイレント上書きしない） | 初期は freee→CRM インポート。名称差異は承認UIで提示し「**名称変更**」か「**外部キー接続のみ（対応表だけ持ち名称は各自維持）**」をユーザーが選択。新規取引先・品目は CRMで作成→freeeへpush |
| 4 | 発行の自動化 | **人の承認を入れる** | 見積・請求は「**下書き生成→承認者が確認→freeeで発行**」。無人自動発行はしない |
| 5 | 接続方式/コスト | **追加コストが無ければ自動連携。Claude Code運用ならMCPでも可** | 連携ロジックは**サーバー関数に集約**し、自動連携（Server Action/cron）を主、**MCPは会話UIとして併用**（同じ関数を叩く） |

> freee API 自体は契約プラン内で追加課金なし。MCPサーバーは自ホスト（Vercel/Edge Function内）とし追加コストを発生させない方針。

---

## 1. 全体アーキテクチャ

### 1.1 連携の向き（マスタの正の所在を反映）

```
                 ┌─────────────── 初期一括 (freee=正) ───────────────┐
   freee取引先/品目 ──────────────── import ─────────────────────────▶ CRM accounts / 品目マスタ
                 └──────────────────────────────────────────────────┘

   CRMで新規作成した取引先/品目 ──── push (CRM=正) ─────────────────▶ freee取引先/品目
   （以後の更新もCRM→freee）

   CRM案件 → 見積(下書き) ───── 承認 ──── push ────────────────────▶ freee見積書
   CRM検収記録 → 請求(下書き) ── 承認 ──── push ────────────────────▶ freee請求書
   freee入金/消込/実売上 ◀────────── pull (cron/webhook) ──────────── freee会計
```

- **マスタ**: 初回は freee を正として CRM へ取り込む。**運用開始後の新規・更新は CRM を正**として freee へ反映（`freee_links` の対応表で名寄せ）。**名称変更は都度ユーザー確認**（変更 or 外部キー接続のみ）でサイレント上書きしない。
- **見積・請求**: 常に **CRM→freee の push**。ただし **必ず「下書き」で生成し、承認を経て発行**。
- **入金・実売上**: **freee→CRM の pull**（毎朝cron。将来 webhook 化）。

### 1.2 2レイヤー構成（自動連携を主・MCPを併用）

| レイヤー | 役割 | 実装 |
|---|---|---|
| **① 連携コア（正）** | freee API 呼び出し・名寄せ・冪等化・監査を担う純粋関数群 | `src/server/freee/*`（Server Action / Edge Function から呼ぶ） |
| **② 自動連携** | 検収→請求下書き、朝cronの入金取込・督促 | 既存 cron / Server Action がレイヤー①を呼ぶ |
| **③ 会話操作（MCP）** | 「この案件の見積作って」等をClaude Codeから指示 | freee MCP（自ホスト）＝レイヤー①と**同じ処理**を叩く薄いラッパ |

> 重要: freee を叩くロジックは**必ずレイヤー①に一本化**。自動連携でもMCPでも同じ関数を通すことで、冪等性・監査・承認ガードを二重実装しない。

---

## 2. モジュール別 機能設計

### F-0 接続・マスタ基盤（全連携の土台）

**主要機能**
1. **OAuth接続**: freee OAuth2（Authorization Code）。事業所（company_id）を選択。**リフレッシュトークンをSupabaseに暗号化保管**しサーバー側で自動更新。トークンはクライアントへ出さない。
2. **マスタ初期インポート（freee=正）**: freee取引先・品目・勘定科目・税区分を CRM へ取り込み、`accounts` と名寄せ（会社名／登録番号でマッチ、曖昧は手動確認UI）。
   - **名称変更は必ず確認**: freeeとCRMで名称が異なる取引先は**サイレント上書きしない**。承認UIに差分（CRM名 / freee名）を並べ、ユーザーが行ごとに「**CRM名称を変更する（freeeに合わせる）**」か「**外部キー接続のみ（両者の名称は維持し `freee_links` の対応だけ持つ）**」を選択。
3. **新規マスタのpush（CRM=正）**: CRMで新規作成した取引先はfreeeへ登録し `freee_links` に対応を保存。以後の更新もCRM→freee。

**画面**: `/app/settings/freee`（接続・同期状況・名寄せ確認）。RLS: `finance` / owner / admin。

---

### F-1 見積連携（CRM案件 → freee見積書）

**主要機能**
1. 案件詳細（`/app/opportunities/[id]`）から「見積を作成」。会社名・品目・金額・税区分を `freee_links` と品目マスタから引き当て、**freee見積の下書きを生成**。
2. **承認フロー**: 下書き → 承認者（finance/owner）が内容確認 → 「発行」で freee 側を確定。CRM側 `opportunities` に見積番号・状態を保持。
3. 差し戻し・再見積に対応（版管理）。

---

### F-2 請求連携（検収時請求・承認つき）★本命

**請求タイミング = 検収時**。`billing_schedules` に検収状態を追加し、**検収の記録をトリガに請求書の下書きを生成**する。

**主要機能**
1. **検収の記録**: 案件の請求行（`billing_schedules`）に「検収済（`accepted_on`）」を記録。one_time は行単位、recurring は当月分を対象。
2. **請求下書きの自動生成**: 検収記録で freee 請求書の**下書き**を生成（金額・品目・取引先を引き当て）。**この時点では未発行**。
3. **承認→発行**: 承認者が確認し「発行」。freee で請求書を確定し、`freee_invoices` に番号・支払期日・状態(issued)を保存。
4. **請求漏れ検知**: 「検収済なのに請求下書き未作成／未発行」を毎朝cronで担当・financeへ通知（既存通知基盤に相乗り、kind=`billing_due`）。

**データモデル追加（billing_schedules 拡張）**
```
alter table billing_schedules add column accepted_on date;          -- 検収日(これが請求トリガ)
alter table billing_schedules add column billing_status text default 'pending';
      -- pending(未検収) / accepted(検収済・下書き待ち) / drafted(下書き有) / issued(発行済) / paid(入金済)
```

---

### F-3 入金・売掛連携（freee → CRM pull）

**主要機能**
1. freee の入金・消込を毎朝取り込み、`freee_invoices.status` を issued→paid、`paid_at` を更新。
2. **売掛（未回収）可視化**: 案件・顧客単位で「請求済・未入金」を集計。
3. **入金遅延アラート**: 支払期日超過を毎朝cronで担当営業＋financeへ通知（kind=`payment_overdue`）。

---

### F-4 予実突合・分析連携

**主要機能**
1. **予実突合**: CRMの `forecast`（weighted/commit）と freee実売上（発行/入金）を月次で突合し、着地精度・差異を算出。週次レビュー画面に「予測 vs 会計実績」を追加。
2. **粗利精度向上（将来）**: freeeの費用（外注・講師費等）を案件へ按分し、既存 `product_profitability` / `exhibition_deal_roi` を推定原価→実原価へ。

---

## 3. データモデル（追加分まとめ）

```
freee_connections   tenant_id, company_id, access_token(enc), refresh_token(enc), expires_at, connected_by
freee_links         tenant_id, entity_type(account/item/opportunity/quote/billing), crm_id, freee_id, synced_at
freee_invoices      tenant_id, billing_schedule_id, opportunity_id, freee_invoice_id, invoice_number,
                    status(draft/issued/paid), amount, issue_date, due_date, paid_at
freee_quotes        tenant_id, opportunity_id, freee_quote_id, quote_number, status(draft/issued), amount, issued_at
freee_sync_log      tenant_id, op, direction(push/pull), entity, crm_id, freee_id, result, error, created_at
-- billing_schedules に accepted_on / billing_status を追加（F-2）
```
RLS: いずれも `finance` / owner / admin。営業には案件詳細で「請求・入金のステータスのみ」を返す読み取りRPC（BO設計の「必要最小限の橋」パターン踏襲）。

---

## 4. 技術要点

| 論点 | 方針 |
|---|---|
| 認証 | freee OAuth2。リフレッシュトークンをSupabaseに暗号化保管、サーバー側で自動更新。サンドボックス→本番の順で検証 |
| 冪等性 | 見積・請求の生成キー = `(billing_schedule_id)` / `(opportunity_id, 版)`。二重発行を防止。全操作を `freee_sync_log` に記録 |
| 承認ガード | 「下書き作成」と「発行」を別Server Actionに分離。発行は `finance`/owner のみ（RLS + ロールチェック） |
| レート制限 | 一括同期は分割（既存の250件チャンク取込と同方式）。失敗はリトライ＋通知 |
| MCP | 自ホストの freee MCP をレイヤー①関数に接続。Claude Code から「見積作って」→ 下書き生成まで。**発行は必ず人の承認を経由**（MCPからでも自動発行しない） |
| コスト | freee APIは契約内・MCPは自ホストで追加課金なし。cronは既存の朝バッチへ相乗り |

---

## 5. 実装ロードマップ（弾で管理）

| 弾 | 内容 | 規模 | 状態 |
|---|---|---|---|
| **第1弾 接続・マスタ** | F-0（OAuth接続・トークン管理・取引先の初期インポート=freee正・新規push=CRM正・名寄せ表・名称変更の都度確認UI） | M | ✅実装（0112）。OAuthアプリ登録＋接続操作は要対話（下記） |
| **第2弾 見積** | F-1（案件→見積下書き→承認→発行） | M | ✅実装。案件詳細の「freee連携」パネル |
| **第3弾 検収請求** ★ | F-2（billing_schedules検収拡張→請求下書き→承認→発行、請求漏れ検知） | L | ✅実装。検収記録→下書き→承認発行、朝cronで検収済未請求を通知 |
| **第4弾 入金・督促** | F-3（入金取込・遅延アラート） | M | ✅実装。設定画面「入金を同期」＋朝cronで期日超過を通知 |
| **第5弾 予実突合** | F-4（予測 vs 実績、週次レビュー統合） | M | 未着手（次フェーズ） |
| **将来** | 品目マスタ同期、粗利の実原価化、freee人事労務、webhook化、MCPサーバー | — | 未着手 |

### 実装メモ（第1〜4弾 / migration 0112）

- **DB**: `supabase/migrations/0112_freee_integration.sql`
  - `is_finance()` ヘルパー、`freee_connections`（トークンはservice roleのみ／secdef `freee_status()` で状態のみ公開）、`freee_links`（名寄せ・link_mode=renamed/linked）、`freee_quotes`、`freee_invoices`、`freee_sync_log`
  - `billing_schedules` に `accepted_on` / `billing_status`（pending→accepted→drafted→issued→paid）
- **Layer①（自動連携・MCP共通の純関数）**: `src/lib/freee/{client,sync,types}.ts`
  - 承認フロー: 見積・請求の「下書き」は **freeeを叩かずCRMに保存**、承認者の「発行」で初めて freee へ push
- **OAuth**: `src/app/api/freee/{connect,callback}/route.ts`
- **Server Actions（承認ガードつき）**: `src/server/actions/freee.ts`
- **UI**: `/app/settings/freee`（接続・名寄せ承認・請求一覧・ログ）、案件詳細の「freee連携」パネル（検収→請求／見積）
- **cron**: `daily-digest` に「検収済・請求未発行」「支払期日超過」を経理へ通知（kind=`freee_due`）
- **要対話の残作業**: freeeアプリ登録（Client ID/Secret取得・コールバックURL設定）と `.env` 設定、設定画面からの「freeeに接続」操作。品目/税区分マッピングの初期表（未確定#3）。→ 詳細は `docs/FREEE_MCP_SETUP.md`

---

## 6. 未確定事項（実装前に確認したい）

1. ~~freeeのプロダクト構成~~ → **確定: freee会計のみ**（見積・請求も freee会計の見積書・請求書APIを使用。freee販売は使わない）。
2. **検収の入力主体**: 検収を記録するのは営業か、finance か（承認フローの起点に影響）。
3. **税区分・品目の対応表**: CRMの商材16種と freee品目/勘定科目のマッピング初期表。
4. **承認者ロール**: 発行承認は `finance` のみか、owner も可か。金額しきい値で承認者を変えるか。
5. **recurring（顧問・サブスク）の検収**: 月次サブスクは「毎月自動で検収済扱い→請求」でよいか（都度検収は不要か）。

---

*本設計は既存の設計書（BACKOFFICE_DESIGN_2026-07 等）と同体裁。実装時は各弾のコミットで本書のステータスを更新すること。*
