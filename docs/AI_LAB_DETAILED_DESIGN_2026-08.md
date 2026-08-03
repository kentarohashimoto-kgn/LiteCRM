# AI Lab 詳細設計書 2026-08

> 対象要件: `AI_LAB_REQUIREMENTS_2026-08.md`（AL-xxx）/ 方式: `AI_LAB_SYSTEM_REQUIREMENTS_2026-08.md`
> マイグレーション番号・`OPENAI_CHAT_MODEL` 等の初期値は実装時点で最新に読み替える。

---

## 1. ルーティング構成

```
src/app/
├── lab/
│   └── [slug]/
│       ├── layout.tsx            /lab 専用ルート（noindex のみ。CRMレイアウトを通さない）
│       ├── page.tsx              /lab/[slug]/chat へ redirect
│       ├── login/page.tsx        個別ログイン（Server Action: labSignIn）
│       ├── preview/route.ts      管理者プレビュートークン受け口（GET）
│       └── chat/
│           ├── page.tsx          新規チャット（会話未選択状態）
│           └── [conversationId]/page.tsx   既存会話
├── api/lab/
│   ├── chat/route.ts             POST: テキスト生成（SSEストリーミング, runtime=nodejs, maxDuration=120）
│   ├── image/route.ts            POST: 画像生成（JSON応答, maxDuration=300）
│   └── upload/route.ts           POST: 添付アップロード（multipart, 送信前に受け取りIDを返す）
└── app/ai-lab/                   ← CRM管理画面（既存 /app レイアウト配下）
    ├── page.tsx                  会社一覧＋新規作成
    └── [companyId]/
        ├── page.tsx              会社詳細（基本設定・接続情報・プレビュー）
        ├── users/page.tsx        受講者管理（一括発行・PW再発行・無効化・ロック解除）
        ├── presets/page.tsx      プリセット・アセット管理
        ├── usage/page.tsx        利用状況（直近12か月の推移＋期間指定の明細）・会話一覧
        └── usage/[conversationId]/page.tsx  会話ログ閲覧（読み取り専用）
    └── reports/page.tsx          会社横断の月別レポート（AL-608）
```

セッション検証は layout ではなく **`ChatScreen`（`src/components/ai-lab/chat-screen.tsx`）の `requireLabCtx()`** で行う。
新規チャットと既存会話でサーバー側の必要データがほぼ同じなので、両ページから同じ組み立てを共有し、
「認可 → データ取得 → 描画」の順序が1か所にしか無い状態にしている。

- `/lab/[slug]/**` は CRM の `/app` レイアウト（Sidebar/Topbar）を**通らない**。ルート `src/app/layout.tsx`（html/body・globals.css）のみ共有。
- `robots`: `/lab` 配下は `noindex`（`layout.tsx` の metadata で `robots: { index: false }`）。

## 2. middleware 変更（AL-102, AL-104）

`src/middleware.ts` に `/lab` 分岐を追加（既存 `/app`・`/help` ガードは不変）:

```ts
if (pathname.startsWith("/lab/")) {
  const slug = pathname.split("/")[2];
  const company = await getLabCompanyCached(slug);      // 下記キャッシュ付きREST
  if (!company || !company.is_active) return notFound404();
  if (!(await verifyBasicAuth(req, company))) return basic401();  // WWW-Authenticate: Basic realm="AI Lab"
  return NextResponse.next();                            // セッション検証は layout / API 側で実施
}
```

- `getLabCompanyCached(slug)`: `${SUPABASE_URL}/rest/v1/ai_lab_companies?slug=eq.<slug>&select=id,is_active,basic_user,basic_secret_hash`（service key、`next: { revalidate: 60 }` 相当のモジュール内メモリキャッシュ60秒）。
- `verifyBasicAuth`: `Authorization: Basic` を decode → user 完全一致 + `SHA-256(pass)` を hex 比較（Web Crypto、タイミング差回避のため固定長比較）。
- **セッション検証を middleware でやらない理由**: ログイン画面自体が `/lab/[slug]/login` にあり、画面ごとの分岐は layout / API 側で行う方が単純なため。middleware は「会社ゲート（Basic）」に責務を限定する。

## 3. 認証・セッション（AL-103〜108）

### 3.1 モジュール `src/lib/ai-lab/session.ts`

```ts
type LabSession = { uid: string; cid: string; exp: number };  // user_id, company_id, epoch秒

signLabSession(s: LabSession): Promise<string>      // base64url(payload) + "." + base64url(HMAC-SHA256(payload, AILAB_SESSION_SECRET))
verifyLabSession(token: string): Promise<LabSession | null>  // 署名不一致・exp超過は null
setLabCookie(token) / clearLabCookie()              // name=ailab_session, HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=43200
requireLabCtx(slug: string): Promise<LabCtx>        // Cookie検証 + slug→company解決 + cid一致 + user/company有効性チェック
                                                    // 失敗時 redirect(`/lab/${slug}/login`)
type LabCtx = { userId: string; companyId: string; slug: string; displayName: string;
                allowedModels: ModelKey[]; defaultModel: ModelKey };
```

- `requireLabCtx` は React `cache()` でリクエスト単位メモ化（既存 `src/lib/session.ts` と同型）。
- API Route 用に `requireLabCtxApi(req)`（redirect せず 401 JSON を返す版）を用意。

### 3.2 ログイン Server Action `src/server/actions/ai-lab-auth.ts`

```
labSignIn(slug, loginId, password):
  1. 会社解決（slug, is_active）
  2. ai_lab_users から company_id + login_id で取得（is_active）
  3. locked_until > now() → 汎用エラー（AL-105: 残り時間は出さない）
  4. verifyPassword（scrypt・timingSafeEqual）失敗 → failed_attempts+1（5回目で locked_until = now()+15min）→ 汎用エラー
  5. 成功 → failed_attempts=0, last_login_at 更新 → signLabSession → Cookie → redirect(chat)
labSignOut(slug): Cookie破棄 → redirect(login)
```

- エラーメッセージは全ケース共通「ログインIDまたはパスワードが正しくありません」（ロック時のみ AL-105 文言）。ユーザー存在の探索を防ぐ。

### 3.3 管理者プレビュー（AL-606）

- 発行（管理画面 Server Action）: `ai_lab_preview_tokens` に `{token: random 32byte hex, company_id, expires_at: now()+60s, used_at: null}` を insert し、URL `/lab/{slug}/preview?token=…` を表示。
- 受け口 `preview/route.ts`（GET）: トークン検証（存在・未使用・期限内・company一致）→ `used_at` 更新 → 会社の **プレビュー用仮想ユーザー**（`ai_lab_users.login_id='__preview__'` を会社作成時に自動作成、ログイン不可フラグ）でセッション発行 → chat へ redirect。Basic認証は middleware で通常どおり要求される。

## 4. データベース設計（`supabase/migrations/0198_ai_lab.sql`）

```sql
-- 会社
create table public.ai_lab_companies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  account_id uuid references accounts(id) on delete set null,   -- CRM取引先への任意リンク（AL-602/702）
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  basic_user text not null,
  basic_secret_hash text not null,            -- SHA-256 hex（middleware Edge比較用）
  allowed_models text[] not null default '{claude-sonnet}',     -- ModelKey の配列
  default_model text not null default 'claude-sonnet',
  monthly_token_budget bigint,                -- null=無制限（in+out合算）
  is_active boolean not null default true,
  starts_on date, ends_on date,               -- 有効期間（null可・表示/入場判定に使用）
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 受講者
create table public.ai_lab_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references ai_lab_companies(id) on delete cascade,
  login_id text not null,
  display_name text not null,
  password_hash text not null,                -- scrypt$N$r$p$salt$hash（Node crypto）
  is_active boolean not null default true,
  is_preview boolean not null default false,  -- __preview__ ユーザー（ログインフォームからは常に拒否）
  failed_attempts int not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, login_id)
);

-- プリセット
create table public.ai_lab_presets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references ai_lab_companies(id) on delete cascade,
  name text not null,
  description text,
  system_prompt text not null default '',
  model_key text,                             -- null=受講者が選択可（AL-505）
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- アセット
create table public.ai_lab_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references ai_lab_companies(id) on delete cascade,
  preset_id uuid not null references ai_lab_presets(id) on delete cascade,
  file_name text not null,                    -- 表示名（「デザインガイド.md」等）
  mime text not null default 'text/plain',
  size_bytes bigint not null default 0,
  extracted_text text not null default '',    -- 注入されるテキスト本体
  created_at timestamptz not null default now()
);

-- 会話
create table public.ai_lab_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references ai_lab_companies(id) on delete cascade,
  user_id uuid not null references ai_lab_users(id) on delete cascade,
  preset_id uuid references ai_lab_presets(id) on delete set null,
  title text not null default '新しいチャット',
  last_model_key text,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on ai_lab_conversations (user_id, is_archived, updated_at desc);

-- メッセージ
create table public.ai_lab_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references ai_lab_companies(id) on delete cascade,
  conversation_id uuid not null references ai_lab_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null default '',
  model_key text,                             -- assistant行のみ
  provider text,                              -- anthropic|openai|google
  input_tokens int, output_tokens int,
  image_paths text[],                         -- bucket: ai-lab-generated のパス（画像生成時）
  error_code text,                            -- provider_error|rate_limited|budget_exceeded|aborted など
  created_at timestamptz not null default now()
);
create index on ai_lab_messages (conversation_id, created_at);
create index on ai_lab_messages (company_id, created_at);   -- レート制限・集計用

-- 日次集計
create table public.ai_lab_usage_daily (
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references ai_lab_companies(id) on delete cascade,
  user_id uuid not null references ai_lab_users(id) on delete cascade,
  date date not null,
  model_key text not null,
  requests int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  images int not null default 0,
  primary key (company_id, user_id, date, model_key)
);

-- プレビュートークン
create table public.ai_lab_preview_tokens (
  token text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references ai_lab_companies(id) on delete cascade,
  created_by uuid references auth.users(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- RLS: 全テーブル有効化。ポリシーは「同一テナントの owner/admin のみ select/insert/update/delete」
-- （既存の is_admin() 相当のヘルパ/membership参照パターンを踏襲）。
-- 受講者側アクセスは service_role のみ（ポリシー不要）。anon/authenticated の直アクセスは全拒否。
alter table public.ai_lab_companies enable row level security;
-- …（全 ai_lab_* テーブルに同様。ポリシー定義は既存マイグレーションの admin 系パターンをコピーして作成）
```

Storage バケット: **`ai-lab-generated` のみ**（マイグレーション内で作成、public=false）。配信は service_role の `createSignedUrls(600)`。
アセットは v1 ではテキストを直接 `ai_lab_assets.extracted_text` に持つため、専用バケットは作らない。

## 5. モデルカタログ `src/lib/ai-lab/models.ts`

```ts
export type ModelKey =
  | "claude-fable" | "claude-opus" | "claude-sonnet" | "claude-haiku"
  | "openai-chat" | "image-gen";

export interface LabModel {
  key: ModelKey;
  label: string;               // 受講者向け表示名（例: "Claude Sonnet"）
  provider: "anthropic" | "openai" | "google";
  kind: "text" | "image";
  modelId: () => string;       // 実モデルID解決（環境変数優先）
  pricePerMTokIn?: number;     // 概算コスト表示用（USD/MTok）。請求根拠にしない
  pricePerMTokOut?: number;
}

export const LAB_MODELS: LabModel[] = [
  { key: "claude-fable",  label: "Claude Fable",  provider: "anthropic", kind: "text",
    modelId: () => process.env.AILAB_MODEL_FABLE  ?? "claude-fable-5" },
  { key: "claude-opus",   label: "Claude Opus",   provider: "anthropic", kind: "text",
    modelId: () => process.env.AILAB_MODEL_OPUS   ?? "claude-opus-5" },
  { key: "claude-sonnet", label: "Claude Sonnet", provider: "anthropic", kind: "text",
    modelId: () => process.env.AILAB_MODEL_SONNET ?? "claude-sonnet-5" },
  { key: "claude-haiku",  label: "Claude Haiku",  provider: "anthropic", kind: "text",
    modelId: () => process.env.AILAB_MODEL_HAIKU  ?? "claude-haiku-4-5" },
  { key: "openai-chat",   label: "ChatGPT（最新）", provider: "openai",  kind: "text",
    modelId: () => process.env.OPENAI_CHAT_MODEL ?? "gpt-5.6" },
  { key: "image-gen",     label: "画像生成",       provider: "openai",  kind: "image",
    modelId: () => process.env.AILAB_IMAGE_MODEL ?? "gpt-image-2" },
];

export function isModelAvailable(key: ModelKey): boolean;   // APIキー・modelId 設定有無で判定
export function resolveModel(key: string): LabModel | null;
```

- 会社の `allowed_models` ∩ `isModelAvailable` が受講者に見えるモデル一覧（AL-403）。積が空なら管理画面で警告。

## 6. プロバイダ抽象 `src/lib/ai-lab/providers/`

```ts
// types.ts
export interface ChatChunk { type: "text"; delta: string }
export interface ChatResult { inputTokens: number; outputTokens: number; stopReason: string }
export interface ChatProvider {
  stream(opts: {
    modelId: string; system: string;
    messages: { role: "user" | "assistant"; content: string }[];
    maxTokens: number; signal: AbortSignal;
    onChunk: (c: ChatChunk) => void;
  }): Promise<ChatResult>;
}
export interface ImageProvider {
  generate(opts: { modelId: string; prompt: string; n: number; signal: AbortSignal })
    : Promise<{ images: Buffer[]; mime: string }>;
}
```

- `anthropic.ts`: `client.messages.stream()`。エラー分類は `src/server/actions/ai.ts` と同一（AuthenticationError→`config_error` / RateLimitError→`rate_limited` / APIError→`provider_error`）。
- `openai.ts`: `fetch("https://api.openai.com/v1/chat/completions", { stream: true, stream_options: { include_usage: true } })` を SSE パース（`data: ` 行を逐次 JSON パース、`[DONE]` で終端）。HTTP 401→`config_error` / 429→`rate_limited` / その他→`provider_error`。
- `image-openai.ts`: 参照画像が無ければ `POST /v1/images/generations`（JSON, `{ model, prompt, n }`）。参照画像があれば `POST /v1/images/edits`（multipart。複数枚は `image[]`、1枚は `image`。content-type は境界文字列のため付けない）。どちらも `b64_json`（URL 返却時はその場で取得）を Buffer 化する。`getImageProvider()` が実装を返す1関数のみの切替点で、将来別プロバイダを足す際もここだけを触る。
- 参照に渡せるのは PNG / JPEG / WebP のみ（gpt-image の制約）。選定は `selectImageReferences()` に純関数として切り出し、新しいものを優先して「8件・合計24MB」で止める。落とした分は理由つきで回答本文に注記する。

## 7. プロンプト合成 `src/lib/ai-lab/prompt.ts`（AL-503/506）

```ts
export const BASE_GUARDRAIL = `あなたは企業研修用のAIアシスタントです。…（研修用途/個人情報注意/不適切要求拒否の定型文）`;
export const ASSET_INJECT_LIMIT = 24_000;   // 文字数

buildSystemPrompt(preset: { system_prompt: string } | null, assets: { file_name, extracted_text }[]):
  { system: string; truncated: boolean }
// BASE_GUARDRAIL + "\n\n" + preset.system_prompt
// + assets を「## 参考資料: <file_name>」ヘッダ付きで連結し、合計 ASSET_INJECT_LIMIT 字で末尾切詰め
// truncated=true は管理画面プレビューの警告表示に使う（AL-503/604）

buildHistory(messages, charBudget = 60_000):  // 直近から遡って詰め、超過分は古い順に落とす（AL-204）
```

## 8. チャットAPI `src/app/api/lab/chat/route.ts`（AL-201〜205）

```
POST body: { slug, conversationId | null, presetId | null, modelKey, message }
runtime = "nodejs"; export const maxDuration = 120;

処理:
 1. requireLabCtxApi → 401
 2. modelKey ∈ ctx.allowedModels かつ isModelAvailable → 不可なら 400 {code:"model_not_allowed"}
 3. レート制限: ai_lab_messages で user_id + role='user' + created_at > now()-1min を count → 10超で 429 {code:"rate_limited"}
 4. 予算: 当月 usage 合算 ≥ monthly_token_budget → 403 {code:"budget_exceeded"}（AL-801）
 5. conversationId null なら会話作成（preset固定・タイトル=message先頭30字）。ある場合は所有者検証（user_id一致、不一致404）
 6. user メッセージ insert
 7. buildSystemPrompt + buildHistory → provider.stream()
 8. SSE で `data: {"delta": "..."}` を転送。完了時 `data: {"done": true, usage, messageId}`
 9. assistant メッセージ insert（content・usage・model_key）。usage_daily を upsert 加算
10. クライアント切断（signal.aborted）: 生成停止し、途中までの content を error_code='aborted' 付きで保存（AL-202）
11. プロバイダ例外: assistant 行を error_code 付き（content=空）で保存し、SSE で {"error": code} を送出
```

- クライアント（`chat-client.tsx`）は `fetch` + `ReadableStream` 読取。停止ボタンは `AbortController.abort()`。

画像API `src/app/api/lab/image/route.ts`: 手順1〜6 同様（レート制限は 3回/分、AL-802）→ `ImageProvider.generate` → `ai-lab-generated` へ保存（`{companyId}/{conversationId}/{messageId}-{n}.png`）→ assistant メッセージに `image_paths` 記録 → `{ images: [signedUrl…] }` を返す。`usage_daily.images` 加算。

## 9. 顧客向けUI `src/components/ai-lab/`

| コンポーネント | 内容 |
|---|---|
| `chat-screen.tsx` | サーバー側の組み立て（`requireLabCtx` → 会話/プリセット/メッセージ取得 → 画像URL署名 → 下記へ受け渡し） |
| `lab-shell.tsx` | 2ペインレイアウト。左: 会話リスト＋「＋新しいチャット」＋ユーザー名/ログアウト。md未満は左ペインをドロワー化 |
| `conversation-list.tsx` | 会話一覧（50件ページング）。リネーム（インライン）・削除（confirm→is_archived、AL-302/303） |
| `chat-client.tsx` | "use client"。メッセージ表示・SSE受信・停止・エラー表示・再送。楽観追加→確定IDで置換 |
| `message-bubble.tsx` | user/assistant吹き出し。assistant は自前Markdownレンダラ（`src/lib/ai-lab/markdown.ts` のASTをReact要素化。`dangerouslySetInnerHTML` 不使用）、コードブロックにコピーボタン、下部にモデル名（AL-404）。画像は署名URLで表示＋ダウンロードリンク（AL-206） |
| `model-picker.tsx` | 許可モデルのセレクト。プリセットの model_key 固定時は disabled 表示（AL-505） |
| `preset-picker.tsx` | 新規会話開始時のみ表示。「標準（プリセットなし）」+ 有効プリセット（name/description のみ、AL-502/504） |
| `lab-login-form.tsx` | ログインフォーム（会社名表示・エラー文言は §3.2） |

- スタイルは既存 Tailwind トークン（`teal.primary` 等）と `globals.css` の共通クラスを使用。CRM の `Sidebar`/`Topbar` は import しない。

## 10. 管理画面（CRM側）

### 10.1 Server Actions `src/server/actions/ai-lab-admin.ts`

すべて冒頭で `requireAdminCtx()`（AL-601）、書込後 `revalidatePath` + `logAudit`。

```
createLabCompany / updateLabCompany / setLabCompanyActive
  - slug検証（正規表現・重複）・Basic秘密は入力平文→SHA-256保存・保存時に __preview__ ユーザー自動作成
createLabUsers(companyId, rows[])            // 一括発行。初期PWは自動生成(12字) → 戻り値でのみ平文返却（AL-603）
resetLabUserPassword / setLabUserActive / unlockLabUser
saveLabPreset / deleteLabPreset / reorderLabPresets
saveLabAsset(presetId, { fileName, text })   // v1はテキスト/Markdown（貼付 or .txt/.md アップロード）。
                                             //   1件20万字上限。extracted_text に保存
deleteLabAsset
createLabPreviewToken(companyId)             // §3.3
```

### 10.2 画面

- **会社一覧** `/app/ai-lab`: テーブル（名称/スラッグ/有効/利用者数/当月トークン/予算消化率バー: 80%超は `accent.orange`）＋新規作成。
- **会社詳細**: 基本設定フォーム、接続情報カード（URL・Basic ID・「体験環境を開く」外部リンク・プレビューリンク発行ボタン）、`accounts` リンク設定。
- **利用者**: 一覧（最終ログイン/状態/ロック）＋一括発行モーダル（複数行入力→結果テーブルをコピー可能表示）。
- **プリセット**: 一覧＋編集ドロワー（system_prompt テキストエリア・モデル固定セレクト・アセット一覧＋アップロード・注入プレビュー: 合成後文字数と truncated 警告、AL-604）。
- **利用状況**: 直近12か月の推移（グラフ＋明細表＋前月比、AL-607）／期間セレクタ＋`ai_lab_usage_daily` 集計テーブル（利用者×モデル）＋概算コスト／会話ドリルダウン（read-only メッセージビュー、AL-605）。
- **月別レポート** `/app/ai-lab/reports`: 対象月セレクタ＋会社別内訳＋モデル別内訳＋会社×月のマトリクス（AL-608）。

集計は **`src/lib/ai-lab/usage-report.ts`**（DBアクセスを持たない純関数）に寄せる。
`ai_lab_usage_daily` は「日 × 会社 × 利用者 × モデル」の粒度なので、月・会社・モデルへ畳む処理を1か所にまとめ、
集計の取り違えをユニットテストで固定できるようにしている。グラフは既存の遅延ロード方式
（`src/components/charts/ai-lab-usage-chart.tsx` がラッパー、`.impl.tsx` が recharts 本体）に合わせ、
recharts を初回バンドルから外す。

### 10.3 動線（AL-701/702）

- `nav-config.ts`: `NavItem` に `adminOnly` 済の「設定」グループへ `{ href: "/app/ai-lab", label: "AI体験環境", icon: Sparkles }` を追加（`injectAdminOnly` パターン）。
- `accounts` 詳細: `ai_lab_companies.account_id` リンクが存在すれば「AI体験環境」カード（会社名＋ `/app/ai-lab/[id]` へのリンク＋ `/lab/{slug}` 外部リンク）。外部リンクは `/app/help` の `target="_blank" rel="noopener noreferrer"` パターンを踏襲。

## 11. エラーコードとUI文言

| code | HTTP | 受講者向け表示 |
|---|---|---|
| `model_not_allowed` | 400 | このモデルは現在利用できません |
| `rate_limited`（自前） | 429 | 送信が集中しています。1分ほど待って再度お試しください |
| `rate_limited`（プロバイダ） | 429 | AIが混み合っています。少し待って再度お試しください |
| `budget_exceeded` | 403 | 利用上限に達しました。担当者にお問い合わせください |
| `config_error` | 500 | 環境設定に問題があります。運営にご連絡ください |
| `provider_error` | 502 | AIの応答中にエラーが発生しました。再度お試しください |
| `aborted` | – | （停止。途中までの回答を保持し「停止しました」を小さく表示） |

## 12. シーケンス（代表: テキスト一問一答）

```
受講者Browser        middleware        /api/lab/chat         Supabase          Anthropic
   │ POST /api/lab/chat  │                  │                   │                 │
   ├────────────────────>│ Basic検証(60sキャッシュ)              │                 │
   │                     ├─────────────────>│ requireLabCtxApi  │                 │
   │                     │                  ├── user msg insert ─>                │
   │                     │                  ├── rate/budget チェック ─>            │
   │                     │                  ├── system合成 ──── assets取得 ──>     │
   │                     │                  ├──────────────── messages.stream ───>│
   │      SSE: delta …   │<─────────────────┤<━━━━━━━━━━━━━━ text delta ━━━━━━━━━┤
   │      SSE: done      │                  ├── assistant insert + usage upsert ─>│
```

## 13. 実装タスク分割（PR単位の目安）

1. マイグレーション 0198 + `models.ts` + `session.ts` + middleware（P1）
2. `/lab` ログイン〜チャットUI + `/api/lab/chat`（Anthropic のみ）（P1）
3. 管理画面: 会社・利用者（P1）+ nav/accounts 動線（P1）
4. OpenAI チャット + 画像生成 + プリセット/アセット（P2）
5. 利用集計・予算/レート制限・プレビューリンク（P3）

各PRで `docs/AI_LAB_TEST_SPEC_2026-08.md` の該当ユニットテストを同梱する。


---

## 14. ファイルの入出力（AL-210〜214）

### 14.1 入力（添付）

| 形式 | 渡し方 |
|---|---|
| 画像 PNG/JPEG/GIF/WebP | `image` コンテンツブロック（base64） |
| PDF | `document` コンテンツブロック（base64・`title` にファイル名）。ページ画像とテキストの両方が読まれる |
| テキスト TXT/MD/CSV | 本文へ差し込み（`## 添付ファイル: <名前>`）。ブロック型を増やさないための割り切り |

アップロードは **送信時ではなくファイル選択時** に `/api/lab/upload` で受け取り、Storage（`ai-lab-uploads`）へ置いてIDだけ返す。
送信リクエストが実ファイルで膨らまないので、大きなPDFを添付しても送信操作は軽いまま。
この時点では会話が未確定なので、会話・メッセージへの紐付けは送信時（`prepareLabTurn`）に行う。

**再送の制御が要点**: API はステートレスなので、過去の添付も毎回送り直すことになる。
`selectWithinBudget`（`src/lib/ai-lab/attachments.ts`）で **新しい順に詰め、入らない分は古いものから落とす**。
直近の質問に紐づく資料が落ちると会話が成立しないため、この順序は崩さない。
落とした添付はファイル名だけ本文に注記し、黙って消えないようにする。実体のダウンロードは予算に残ったものだけに絞る。

### 14.2 出力（ファイル生成）

Anthropic の Agent Skills（`xlsx` / `docx` / `pptx` / `pdf`）＋ コード実行ツールを使う。
`client.beta.messages.stream` に `container.skills` と `code_execution_20260521` を渡し、
betas は `code-execution-2025-08-25` / `skills-2025-10-02` / `files-api-2025-04-14`。

- 逐次テキストは `stream.on("text")` で受け、**生成物の取り出しは `finalMessage()` の完成ブロックから行う**
  （ストリーム中の部分ブロックを自前で組み立てない）。
- サーバー側ツールが上限に達すると `stop_reason: "pause_turn"` で返るため、
  アシスタント発言を積んで最大4回まで投げ直す。
- 生成ファイルは Files API から取得して `ai-lab-generated` へ保存し、`ai_lab_attachments`（`origin='generated'`）に記録。
  表示は都度の署名URL。1件の取得失敗で回答ごと失わせないよう、取れたものだけ返す。
- コード実行には従量課金が発生しうるため、`ai_lab_companies.file_tools_enabled` で会社ごとに切れる（既定オン）。
  無効の会社ではツールも `FILE_TOOLS_NOTE` も付けない。

### 14.3 データ

`ai_lab_attachments` は添付と生成物を同じ表で扱い、`origin`（upload / generated）と `kind`（image / document / output）で区別する。
入力として送り返すのは `origin='upload'` のみ（AIの生成物を入力に戻さない）。
