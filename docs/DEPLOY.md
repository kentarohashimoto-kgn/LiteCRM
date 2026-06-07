# CATORCE Sales OS デプロイ手順（Vercel + Supabase）

社員がブラウザからアクセスできる公開URLを発行するための手順です。
所要時間の目安は **15〜20分**。GitHub・Vercel・Supabase のアカウントがあれば完了できます。

---

## 全体像

```
GitHub(コード) ──→ Vercel(ホスティング/公開URL) ──→ Supabase(認証・DB)
```

- **GitHub**: ソースコード（このリポジトリ）
- **Vercel**: Next.jsアプリをビルドして公開URLを発行
- **Supabase**: ログイン認証と業務データの保管（構築済み）

すでに Supabase 側（プロジェクト `catorce-sales-os`・スキーマ・初期データ・アカウント）は
構築済みです。**この手順では Vercel への公開のみ** を行います。

---

## 事前に用意する3つの環境変数

Vercel に設定する値です。Supabase ダッシュボードから取得します。

| 変数名 | 取得場所 | 性質 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → **API** → Project URL | 公開可 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 同 API → Project API keys → **anon public** | 公開可 |
| `SUPABASE_SERVICE_ROLE_KEY` | 同 API → Project API keys → **service_role**（要「Reveal」） | **秘密** |

### 値の取得手順
1. https://supabase.com/dashboard にログイン
2. プロジェクト **catorce-sales-os** を開く
3. 左下の歯車 **Project Settings** → **API**
4. 「Project URL」と「Project API keys」の各値をコピー
   - `service_role` は機密のため「Reveal」を押すと表示されます。**社外・チャット・Gitに貼らない**こと

> 参考: `NEXT_PUBLIC_SUPABASE_URL` は `https://beztpddkezjlrlixjjqq.supabase.co` です。

---

## 手順1: GitHub リポジトリを用意

このコードが GitHub にある状態にします（すでに push 済み）。

- リポジトリ: `kentarohashimoto-kgn/LiteCRM`
- ブランチ: `claude/keen-mayer-yJCVC`

> 本番運用するブランチは、最終的に `main` にマージするのがおすすめです。
> まずは現行ブランチのまま公開して問題ありません（手順2でブランチを指定できます）。

---

## 手順2: Vercel でプロジェクトを作成

1. https://vercel.com にログイン（「Continue with GitHub」が簡単）
2. ダッシュボードで **Add New… → Project**
3. **Import Git Repository** で `LiteCRM` を選び **Import**
   - 初回は「Adjust GitHub App Permissions」でリポジトリへのアクセス許可が必要な場合があります
4. **Configure Project** 画面で以下を確認:
   - **Framework Preset**: `Next.js`（自動検出）
   - **Root Directory**: `./`（そのまま）
   - **Build Command / Output**: 既定のまま（変更不要）
5. （任意）公開するブランチを変える場合は、デプロイ後に
   Settings → Git → **Production Branch** で `claude/keen-mayer-yJCVC` を指定

---

## 手順3: 環境変数を登録

**Configure Project** 画面の **Environment Variables** セクションで、上の3つを追加します。

| Key | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://beztpddkezjlrlixjjqq.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | （anon public キー） |
| `SUPABASE_SERVICE_ROLE_KEY` | （service_role キー） |

- 各行で Key と Value を入力 → **Add**
- 環境は **Production / Preview / Development すべてにチェック**（既定でOK）
- `SUPABASE_SERVICE_ROLE_KEY` は **Sensitive** として扱われます（値が表示されなくなる）

> あとから変更する場合: プロジェクト → **Settings → Environment Variables**
> 変更後は **Deployments → 最新 → ⋯ → Redeploy** で反映。

---

## 手順4: デプロイ

1. **Deploy** ボタンを押す
2. 2〜3分でビルド完了 → `https://litecrm-xxxx.vercel.app` のような公開URLが発行されます
3. URL を開き、ログイン画面が表示されればOK

---

## 手順5: Supabase 側で本番URLを許可（重要）

ログイン後のリダイレクトを正しく動かすため、Supabase に本番URLを登録します。

1. Supabase → **Authentication** → **URL Configuration**
2. **Site URL** に Vercel のURL（例 `https://litecrm-xxxx.vercel.app`）を設定
3. **Redirect URLs** に以下を追加（**Add URL**）:
   - `https://litecrm-xxxx.vercel.app/**`
4. 保存

> これを忘れると、ログインは通っても画面遷移で弾かれることがあります。

---

## 手順6: 動作確認

公開URLで以下を確認します。

1. 代表アカウントでログイン
   - メール: `kentaro.hashimoto@catorce.jp`
   - パスワード: `Catorce2026!`
2. ダッシュボード・週次レビュー・商談一覧にデータが表示される
3. **設定 → メンバーを発行** で社員アカウントを作成できる
4. 外部営業（`tanaka@example.com` / `Catorce2026!`）でログインし直すと、
   **自分の担当案件のみ** 表示されることを確認

---

## 社員アカウントの配り方

1. 代表 or 管理者でログイン → **設定 → メンバーを発行**
2. 氏名・メール・初期パスワード・ロールを入力して発行
3. 社員に「公開URL・メール・初期パスワード」を共有
4. 各自ログイン後、パスワード変更を案内（※パスワード変更UIは今後追加予定。
   当面は管理者が再発行で対応可能）

### ロールの目安
| ロール | 用途 |
|---|---|
| owner / admin | 代表・管理者。全件 + メンバー発行 |
| sales_manager | Sales Ops。全件閲覧・分析 |
| sales_rep / external_sales | 営業担当・外部営業。自分の担当案件のみ |
| viewer | 閲覧のみ |

---

## カスタムドメイン（任意）

`sales.catorce.jp` のような独自ドメインで公開する場合:

1. Vercel → プロジェクト → **Settings → Domains** → ドメインを追加
2. 表示される DNS レコード（CNAME 等）を、ドメイン管理画面に登録
3. 反映後、手順5の Supabase URL も新ドメインに更新

---

## 自動デプロイ（CI/CD）

Vercel は GitHub と連携済みのため、**対象ブランチに push するたびに自動で再デプロイ**されます。
プルリクエストごとにプレビューURLも発行されるので、社員に見せる前に確認できます。

---

## トラブルシューティング

| 症状 | 原因 / 対処 |
|---|---|
| ビルドが失敗する | 環境変数の綴り（特に `NEXT_PUBLIC_` 接頭辞）を確認。`npm run build` がローカルで通るかも確認 |
| ログインできない | メール/パスワード誤り、または anon キーの設定ミス。Supabase → Authentication → Users にユーザーがいるか確認 |
| ログイン後に弾かれる/ループする | 手順5の **Site URL / Redirect URLs** 未設定。本番URLを登録 |
| 「メンバー発行」でエラー | `SUPABASE_SERVICE_ROLE_KEY` 未設定。Vercelの環境変数に追加して Redeploy |
| データが表示されない | Supabase プロジェクトが一時停止（Free planは無操作で停止）。ダッシュボードで Restore |
| 変更が反映されない | 環境変数変更後は **Redeploy** が必要 |

---

## ローカル開発（参考）

```bash
git checkout claude/keen-mayer-yJCVC
cp .env.example .env.local   # 3つの環境変数を設定
npm install
npm run dev                  # http://localhost:3000
```

ローカルでログインを試す場合も、手順5の Redirect URLs に
`http://localhost:3000/**` を追加しておくと確実です。
