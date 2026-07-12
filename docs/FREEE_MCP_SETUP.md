# freee 連携 セットアップ手順 & MCP 運用ガイド

対象: `docs/FREEE_INTEGRATION_DESIGN_2026-07.md` の第1〜4弾（migration 0112）で実装した freee 会計連携。

---

## 1. freee アプリの登録（初回のみ・対話操作）

1. [freeeアプリストア（開発者向け）](https://app.secure.freee.co.jp/developers/applications) で **アプリを新規作成**。
2. 以下を控える / 設定する:
   - **Client ID** / **Client Secret**
   - **コールバックURL** に `https://<本番URL>/api/freee/callback`（ローカルは `http://localhost:3000/api/freee/callback`）
3. 会計データにアクセスするため、必要な権限（取引先・見積・請求・取引の参照/更新）を有効化。

> まずは freee の **テスト（サンドボックス）環境**のアプリで接続確認 → 本番に切替えるのが安全です。

## 2. 環境変数（`.env.local` / Vercel）

```
FREEE_CLIENT_ID=...
FREEE_CLIENT_SECRET=...            # サーバー専用・秘匿（Vercelは Sensitive）
FREEE_REDIRECT_URI=https://<本番URL>/api/freee/callback
NEXT_PUBLIC_APP_URL=https://<本番URL>
SUPABASE_SERVICE_ROLE_KEY=...      # 既存。トークン保管の読み書きに必要
```

3つの `FREEE_*` が未設定なら連携は無効（設定画面で「接続」時にエラー表示）。

## 3. マイグレーション適用

`supabase/migrations/0112_freee_integration.sql` を本番 Supabase に適用（CLI or ダッシュボード）。
`is_finance()` / `freee_*` テーブル / `billing_schedules.accepted_on,billing_status` / `freee_status()` が作成される。

## 4. 接続と初期名寄せ（対話操作）

1. 経理(finance)／代表／管理者でログイン → **設定 → freee連携**。
2. 「freeeに接続」→ freeeの認可画面で許可 → 事業所が保存される。
3. 「freee取引先を取り込む」→ 名寄せ候補が表示:
   - **名称が異なる**行は、行ごとに「**名称をfreeeに合わせる**」か「**外部キー接続のみ**（名称は各自維持し対応表だけ）」を選ぶ（サイレント上書きはしない）。
   - **名称一致**行は「接続」で対応表に追加。

## 5. 日常運用フロー

| 操作 | 場所 | 動き |
|---|---|---|
| 見積 | 案件詳細「freee連携」パネル | 「下書きを作成」→ 承認者が「承認して発行」で freee見積書を作成 |
| 検収→請求 | 同パネル | 請求予定に「検収を記録」→ 請求下書き自動生成 → 「承認して請求発行」で freee請求書を作成 |
| 入金取込 | 設定→freee連携「入金を同期」 | 発行済み請求の入金状況を反映（issued→paid） |
| 督促・請求漏れ | 毎朝の通知（cron） | 「検収済・請求未発行」「支払期日超過」を経理へベル通知（kind=`freee_due`） |

> **承認ガード**: 下書きは freee に送信されません。「発行」時に初めて freee へ push します。発行・接続・同期は経理／代表／管理者のみ。

## 6. MCP からの操作（Claude Code 運用）

設計方針どおり、freee を叩くロジックは `src/lib/freee/{client,sync}.ts` の **Layer① 純関数に一本化**しています。
アプリの自動連携（Server Action / cron）と MCP は、いずれもこの同じ関数を通します（承認・冪等・監査を二重実装しない）。

MCP サーバーを立てる場合の推奨:

- MCP ツールは Layer① 関数（`createQuoteDraft` / `issueQuote` / `recordAcceptanceAndDraft` / `issueInvoice` / `importPartners` / `syncPayments`）に対応させる。
- **「発行」に相当するツールは、必ず人の承認を挟む**（Claude Code 上で確認 → 実行）。自動発行はしない。
- 認証・トークンは `freee_connections`（同一DB）を共有し、`getFreeeClient(tenantId)` を再利用する。

> 現時点ではアプリ内の Server Action が正の実行経路です。MCP サーバー（別プロセス）は次フェーズで、この Layer① を薄くラップして追加します。

## 7. セキュリティ・監査

- OAuthトークンは `freee_connections` に保管し、**authenticated には一切公開しない**（RLSポリシー未付与＝0件）。読み書きは service role のみ。状態は secdef `freee_status()` が許可列だけ返す。
- 全 freee 操作は `freee_sync_log` に記録（op / direction / result / message）。
- 見積・請求・名寄せテーブルは `is_finance`（経理／代表／管理者）のRLSで保護。営業ロールからは 0 件。

## 8. 既知の制約・次フェーズ

- 見積/請求の明細は現状 **1行（案件名・数量1・税10%）** で生成。複数明細・品目/税区分マッピングは未確定#3の確定後に拡張。
- 品目マスタ同期・粗利の実原価化・予実突合（F-4）・webhook化は次フェーズ。
- recurring（顧問・サブスク）の検収運用（毎月自動検収扱いにするか）は未確定#5。
