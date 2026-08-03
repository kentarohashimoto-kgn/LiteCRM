# AI Lab システム化要件まとめ 2026-08

> 要件定義（`AI_LAB_REQUIREMENTS_2026-08.md`）を実現するための技術方針・構成の決定事項。詳細は `AI_LAB_DETAILED_DESIGN_2026-08.md`。

---

## 1. 全体アーキテクチャ

```
┌──────────────────────────── Vercel（既存プロジェクト / hnd1） ────────────────────────────┐
│  Next.js 14 App Router                                                                    │
│                                                                                           │
│  /app/**        CRM本体（既存・Supabase Authセッション）                                   │
│  /app/ai-lab/** AI Lab 管理画面（既存 requireAdminCtx で保護）            ──┐              │
│                                                                            │ service_role │
│  /lab/[slug]/** 顧客向け体験環境（Basic認証 + 独自セッションCookie）      ──┤              │
│  /api/lab/**    チャット/画像生成 Route Handler（SSEストリーミング）      ──┘              │
│                                                                                           │
│  middleware.ts  ─ /lab/** に Basic認証・セッション検証を追加（既存 /app ガードは不変）      │
└───────────────┬───────────────────────────┬───────────────────────────────────────────────┘
                │                           │
        Supabase (Postgres+RLS+Storage)   AIプロバイダ
        ai_lab_* テーブル群 /              Anthropic Messages API（stream）
        buckets: ai-lab-assets,           OpenAI Chat Completions / Responses（stream）
                 ai-lab-generated         画像生成: OpenAI Images または Google Imagen（§5）
```

## 2. 分離方式の決定

| 論点 | 決定 | 理由 |
|---|---|---|
| デプロイ単位 | **既存 Vercel プロジェクトに同居**（パス `/lab` で分離） | AI SDK・Sentry・CI・環境変数・Supabase接続を全て再利用。別プロジェクト分離は運用コスト増に見合わない。将来カスタムドメインが必要になれば Vercel のドメイン→パス割当 or rewrite で対応可能 |
| DB | **同一 Supabase・専用テーブル群 `ai_lab_*`** | 管理画面（CRM側）から自然に参照でき、テナント境界（`tenant_id`）も既存方針を踏襲。CRM本体テーブルとはFKを `accounts` への任意リンク1本に限定し、結合度を最小化 |
| 認証 | **受講者は Supabase Auth を使わない独自認証**（bcrypt + HMAC署名Cookie） | Supabase Auth に受講者を入れると `memberships`/RLS 前提（auth.uid=CRMユーザー）が崩れ、既存ポリシー全体の再点検が必要になる。受講者は数十〜数百人規模・機能はチャットのみであり、独自軽量認証のリスクが最小 |
| RLS | `ai_lab_*` は **RLS有効・エンドユーザー直アクセスなし** | 受講者アクセスは全て Server Action / Route Handler 経由で service_role を使い、**アプリ層で company_id/user_id を強制スコープ**。RLSポリシーは「CRM管理者のテナント内閲覧・操作」のみ許可し、anon/authenticated の直クエリは全拒否（漏洩時の二重防御） |
| UI | CRMのTailwindトークンは再利用しつつ、`/lab` は **専用レイアウト**（Sidebar/Topbar非共有） | 「CRMと分離した画面」の要件。受講者にCRMの情報構造を一切見せない |

## 3. 認証・セッション設計（要点）

1. **Basic認証（会社ゲート）** — `middleware.ts` の matcher に `/lab/:path*` を追加。スラッグから会社を引き（Supabase REST + service key、60秒メモリキャッシュ）、`Authorization: Basic` を SHA-256 ハッシュ比較。不一致は 401 + `WWW-Authenticate`。
2. **個別ログイン** — Server Action。bcrypt 照合（`bcryptjs` を新規依存に追加）、5連続失敗で15分ロック（DBカウンタ）。
3. **セッション** — `ailab_session` Cookie。ペイロード `{uid, cid, exp}` を `AILAB_SESSION_SECRET` で HMAC-SHA256 署名（自前実装、新規依存なし・Edge/Node両対応のWeb Crypto）。有効12時間・HttpOnly・Secure・SameSite=Lax・Path=/。
4. **管理者プレビュー** — 管理画面がワンタイムトークン（DB保存・60秒・単回）付きURLを発行 → `/lab/{slug}/preview?token=…` がトークン検証後に通常セッションを発行。Basic認証はプレビューURLでも要求される（middlewareは素通しにしない。トークンにBasic回避を含めるのは攻撃面が増えるため不採用。管理画面にBasic認証情報の表示を併設して補う）。

## 4. データ（新規テーブル・ストレージ）

マイグレーション **`supabase/migrations/0198_ai_lab.sql`**（番号は実装時点の最新+1に読み替え）。

| テーブル | 役割 |
|---|---|
| `ai_lab_companies` | 会社（slug, Basic認証情報ハッシュ, 利用可能モデル, 既定モデル, 月間予算, 有効フラグ, accounts への任意FK, tenant_id） |
| `ai_lab_users` | 受講者（company_id, login_id, 表示名, password_hash, 失敗回数/ロック, 有効フラグ, last_login_at） |
| `ai_lab_presets` | プリセット（system_prompt, モデル固定, 表示順, 有効フラグ） |
| `ai_lab_assets` | アセット（preset_id, storage_path, mime, size, extracted_text, 抽出ステータス） |
| `ai_lab_conversations` | 会話（user_id, title, preset_id, 最後に使ったモデル, is_archived） |
| `ai_lab_messages` | メッセージ（conversation_id, role, content, model_key, provider, in/out tokens, image_paths[], error_code） |
| `ai_lab_usage_daily` | 日次集計（company_id, user_id, date, model_key, requests, in/out tokens, images）— メッセージ書込時に upsert 加算 |
| `ai_lab_preview_tokens` | 管理者プレビュー用ワンタイムトークン |

- **Storage**: バケット `ai-lab-assets`（非公開・管理者アップロード）/ `ai-lab-generated`（非公開・生成画像。表示は署名URL 10分）。
- 全テーブル `tenant_id` 保持（既存マルチテナント方針）。当面は単一テナント運用でも列は必須とする。

## 5. AIプロバイダ連携

| 用途 | 接続 | 備考 |
|---|---|---|
| Claude 4種 | `@anthropic-ai/sdk`（既存 ^0.110.0）`messages.stream()` | モデルID: `claude-fable-5` / `claude-opus-5` / `claude-sonnet-5` / `claude-haiku-4-5-20251001`（カタログで管理） |
| ChatGPT 最新 | **OpenAI REST API を `fetch` で直接呼ぶ**（`/v1/chat/completions`、SSEストリーミング） | モデルIDは `OPENAI_CHAT_MODEL`。SDK を足さない判断は §9 参照 |
| 画像生成 | OpenAI Images API（`/v1/images/generations`、`gpt-image-2`）。`ImageProvider` インターフェースで抽象化し将来の差し替えに備える | モデルIDは `AILAB_IMAGE_MODEL`（既定 `gpt-image-2`） |

- チャットは **Route Handler（`/api/lab/chat`、Node runtime）から SSE ストリーミング**。Server Actions はストリーミング応答に不向きのため使わない（更新系のみServer Action）。
- システムプロンプト合成順: ①コード内ベースガードレール → ②プリセット system_prompt → ③アセット抽出テキスト（合計 24,000 字上限で切詰め）。
- トークン数はプロバイダ応答の usage をそのまま記録。概算コストはカタログ内単価表（管理画面表示用・請求根拠にはしない）。

## 6. 環境変数（追加分）

| 変数 | 用途 | 必須 |
|---|---|---|
| `AILAB_SESSION_SECRET` | セッション署名鍵（32byte以上ランダム）。**未設定なら `SUPABASE_SERVICE_ROLE_KEY` から用途を分けて派生**するため設定なしでも動くが、鍵の差し替えでセッションが失効するので本番は明示設定を推奨 | – |
| `OPENAI_API_KEY` | ChatGPT・画像生成。`.env.example` 既存キーを本番設定 | ✔ |
| `OPENAI_CHAT_MODEL` | 「ChatGPT最新」の実モデルID（既定 `gpt-5.1`） | – |
| `AILAB_IMAGE_MODEL` | 画像生成の実モデルID（既定 `gpt-image-2`） | – |
| `AILAB_MODEL_FABLE` / `_OPUS` / `_SONNET` / `_HAIKU` | Claude 各モデルIDの上書き（改廃時の追従用） | – |

既存の `ANTHROPIC_API_KEY` / `NEXT_PUBLIC_APP_URL` / Supabase系はそのまま利用。

## 7. 非機能の実現方式

| 要件 | 方式 |
|---|---|
| 会社間分離 | セッションの `cid` と URLスラッグの会社IDを毎リクエスト照合（不一致は404）。全クエリ `company_id` 条件必須（データアクセス層 `src/lib/ai-lab/db.ts` に集約し、生クエリ散在を禁止） |
| レート制限 | `ai_lab_messages` の直近1分カウント（DB集計）。Vercelのサーバレス特性上インメモリ制限は使わない |
| 予算制御 | `ai_lab_usage_daily` の当月合算を送信前チェック（キャッシュ60秒）。超過時 402 相当のエラーコードを返しUI表示 |
| 監査 | 既存 `audit_logs` 方針に準拠し、lab側は `ai_lab_messages`/ログイン記録で代替。管理操作は既存 `logAudit` を呼ぶ |
| 監視 | 既存 Sentry に統合（`/lab`・`/api/lab` も対象）。プロバイダエラーは error_code 分類して記録 |
| 性能 | 会話一覧・メッセージはページング（会話50件・メッセージ100件）。ストリーミングは `ReadableStream` パススルーでバッファしない |

## 8. 既存資産の再利用マップ

| 再利用するもの | 場所 | 用途 |
|---|---|---|
| Anthropic 呼び出しパターン・エラーハンドリング | `src/server/actions/ai.ts` | プロバイダ実装の参考（AuthenticationError/RateLimit/APIError の分類） |
| Tailwind デザイントークン・共通クラス | `tailwind.config.ts` / `src/app/globals.css` | `/lab` UIも同一トーンで実装 |
| UIプリミティブ | `src/components/ui/primitives.tsx` | 管理画面で使用（/lab側は必要最小限を流用） |
| ナビ定義 | `src/components/layout/nav-config.ts` | AL-701 のメニュー追加 |
| 監査ログ | `logAudit`（`src/server/actions.ts`） | 管理操作の記録 |
| PDFテキスト抽出 | 既存ドキュメント基盤（`src/lib/ai/embeddings.ts` 周辺の抽出処理） | アセット抽出。流用不可なら `pdf-parse` 系を追加 |
| CI | `.github/workflows/ci.yml` | typecheck / vitest / build に自動で乗る |

## 9. 新規依存パッケージ

**なし。**（`package.json` 無変更でリリースできる構成とした）

| 必要機能 | 採用手段 | 依存を足さない理由 |
|---|---|---|
| OpenAI チャット/画像生成 | REST API を `fetch` で直接呼ぶ | 使うのは2エンドポイントのみ。SDK追加はビルド重量とバージョン追従コストに見合わない |
| 受講者パスワードハッシュ | Node 標準 `crypto.scrypt`（N=16384, r=8, p=1, salt16B, keylen64B） | bcryptjs 同等の強度をゼロ依存で得られる。保存形式 `scrypt$N$r$p$salt$hash` で将来のパラメータ変更に対応 |
| セッション署名 | Web Crypto の HMAC-SHA256 | Edge/Node 両対応。JWTライブラリ不要 |
| Markdown 描画 | 自前レンダラ `src/lib/ai-lab/markdown.ts`（見出し/箇条書き/番号付き/表/コードブロック/インラインコード/強調/リンク） | react-markdown+remark-gfm の追加を避け、出力をユニットテストで固定できる。**HTMLは埋め込まずReact要素を組み立てるためXSS面が閉じる**（`dangerouslySetInnerHTML` を使わない） |
| PDFテキスト抽出 | v1は **テキスト/Markdownのみ受け付ける**。PDFは管理者がテキスト貼付で登録 | pdf-parse系の追加を避ける。PDF対応は P4 として切り出し |

## 10. 段階リリース計画

| フェーズ | 内容 | 状況 |
|---|---|---|
| **P1（MVP）** | 会社/利用者管理・Basic認証・個別ログイン・Claude 4種チャット（ストリーミング）・履歴・CRM動線 | 実装済み |
| **P2** | OpenAI チャット・画像生成・プリセット/アセット・モデル別利用可否 | 実装済み |
| **P3** | 利用集計ダッシュボード・予算/レート制限・プレビューリンク・一括発行UX | 実装済み |
| **P4（未着手）** | PDFアセットのテキスト抽出・RAG化、受講者からのファイル添付、共有リンク/エクスポート | 未着手 |

P1〜P3 のユニットテストは `tests/ai-lab-*.test.ts`（79件）として CI に載っている。
手動ケース（IT/ST/RT）は `docs/AI_LAB_TEST_SPEC_2026-08.md` に従いステージングで実施する。
