# CATORCE Sales OS

**営業活動を記録するだけのCRMから、未来の売上を作る営業OSへ。**

株式会社カトルセ向けに開発した AI営業OS / CRM / SFA / 売上予測アプリです。
商談・ヨミ・商品・流入経路・営業担当を一元管理し、毎週の営業会議で
**今月の着地と今週打つべき施策**まで導きます。将来の BtoB SaaS 外販を見据え、
最初からマルチテナント構成で設計しています。

本番バックエンドは **Supabase(PostgreSQL + Auth + Row Level Security)**。
実際のログイン・データ永続化・ロール別アクセス制御で、社員が日常業務に使えます。

---

## 特長

- 📊 **ダッシュボード** — 今月の目標 / Commit / Best Case / Weighted / Gap を一目で
- 🗓 **週次レビュー画面(最重要)** — 「確認」で終わらせず、今週の打ち手を決める会議画面
- 🎯 **商談管理(SFA)** — 金額・ステージ・ヨミ・確度・次アクション・リスクを管理
- 🔮 **売上予測** — 今月 / 来月 / 四半期 / 12ヶ月ローリング(`weighted = 金額 × 確度`)
- 🚨 **危険案件の自動検知** — 放置案件・次アクション未設定・提案後フォロー漏れ
- 📈 **分析** — 営業マン別 / 商品別 / 流入経路別の成果分析
- 🔐 **ロール別アクセス制御(RLS)** — 外部営業は自分の担当案件のみ(DBレベルで担保)
- 🏢 **マルチテナント** — CATORCEも1テナント。固有情報はseed/設定として保持
- 🧠 **マインドマップ(管理者専用)** — Googleカレンダー × 案件・ヨミ × 週次報告から
  今週/来週の予定マップを自動生成し、事前準備の漏れを検出。研修・セミナー構成の検討と
  プレゼンにも使える([設計](docs/MINDMAP_DESIGN_2026-07.md))

デザインは **カトルセ提案書デザインガイド**(Primary Teal `#008C8C` / Accent Orange
`#F59A2A`、配色比率 白・グレー70% / ティール20% / オレンジ10%、数字は大きく単位は
小さく)に準拠しています。

---

## 技術スタック

| 領域 | 技術 |
|---|---|
| フレームワーク | Next.js 14 (App Router) / React 18 / TypeScript |
| UI | Tailwind CSS(CATORCEデザイントークン) |
| グラフ | Recharts |
| 認証 | Supabase Auth(メール+パスワード) |
| DB / 権限 | Supabase PostgreSQL + Row Level Security |

---

## セットアップ済みの本番環境

初期構築として、以下が **すでに用意されています**(管理者が引き継ぎ可能)。

- Supabase プロジェクト: `catorce-sales-os`(東京リージョン / Freeプラン)
- スキーマ・RLS・CATORCE初期マスタ(商材16・流入経路14・売上目標6ヶ月)
- メンバー4名(下記)とサンプル商談データ(商談20・タスク・活動・リード)

### 初期アカウント(初期パスワードは管理者から安全な経路で共有・初回ログイン後に必ず変更)

| 氏名 | メール | ロール | 見える範囲 |
|---|---|---|---|
| 橋本 健太郎 | kentaro.hashimoto@catorce.jp | owner(代表) | 全件 |
| 佐藤 美咲 | ops@catorce.jp | sales_manager | 全件 |
| 田中 亮 | tanaka@example.com | external_sales | 自分の担当のみ |
| 鈴木 彩 | suzuki@example.com | external_sales | 自分の担当のみ |

新しい社員アカウントは、ログイン後 **設定 → メンバーを発行**(owner/admin のみ)から
メール・初期パスワード・ロールを指定して発行できます。

---

## ローカルで動かす

```bash
git clone <repo> && cd <repo>
git checkout claude/keen-mayer-yJCVC

cp .env.example .env.local
#  NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY を設定
#  (URL と anon キーは Supabase ダッシュボード → Project Settings → API)

npm install
npm run dev
# http://localhost:3000 → /login でメール+パスワードログイン
```

> `SUPABASE_SERVICE_ROLE_KEY` は「設定→メンバー発行」でのみ使用します(サーバー専用・秘匿)。
> 未設定でもログインや閲覧・編集は動作します。

---

## Vercel へのデプロイ(社員が使えるURLを発行)

> 詳細な手順書は **[docs/DEPLOY.md](docs/DEPLOY.md)** を参照(環境変数の取得場所・
> Supabase URL設定・トラブルシューティングまで網羅)。以下は要約です。

1. このリポジトリを GitHub に push(済み)
2. [vercel.com](https://vercel.com) で **New Project** → 本リポジトリを Import
3. Framework は自動で Next.js。**Environment Variables** に以下を登録:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`(Sensitive)
4. **Deploy** → 発行された `https://xxx.vercel.app` を社員に共有
5. Supabase ダッシュボード → Authentication → URL Configuration に、本番URLを
   `Site URL` / `Redirect URLs` として追加

> 値は Supabase ダッシュボード → Project Settings → API で確認できます
> (anon = "Project API keys" の anon、service_role = 同 service_role)。

---

## アーキテクチャ / ディレクトリ

```
src/
  middleware.ts                  セッション更新 + /app 配下の認証ガード
  app/
    login/                       メール+パスワードログイン
    app/
      dashboard/  reviews/weekly/  opportunities/  forecast/
      accounts/  contacts/  leads/  tasks/  activities/
      analytics/(sales-reps|products|channels)/  settings/
  components/  ui/ layout/ charts/ opportunities/
  lib/
    supabase/server.ts           RLS適用のサーバークライアント
    supabase/admin.ts            service role クライアント(メンバー発行)
    session.ts                   認証コンテキスト(getCtx)
    data/workspace.ts            1リクエストの業務データを Supabase から取得(RLSスコープ済)
    data/select.ts               Workspace に対する純粋な参照ヘルパー
    forecast.ts / risk.ts / analytics.ts  予測・危険案件・分析ロジック
    constants.ts                 ステージ/ヨミ/ロール/CATORCEマスタ
  server/actions.ts              Server Actions(認証・作成・更新・メンバー発行)
supabase/
  migrations/
    0001_init.sql                テーブル定義・インデックス・トリガ
    0002_rls.sql                 Row Level Security(基本)
    0003_profiles_and_auth.sql   profiles + サインアップ連動
    0004_fix_write_policies.sql  書き込みポリシー分割(SELECT漏れ修正)
  seed.sql                       CATORCE初期マスタ
```

データアクセスは **Supabase の RLS が一次防御**です。`workspace.ts` が取得する行は
すべてログインユーザーの権限でスコープ済みのため、画面側はロールによる再フィルタを
行いません(外部営業=自分の担当案件のみ、owner/admin/Sales Ops=全件)。

---

## 要件定義書との対応

| 要件 | 実装 |
|---|---|
| MVP P0/P1機能 (7.2) | ✅ 顧客/担当者/リード/商談/活動/タスク/予測/放置検知/週次レビュー/各種分析 |
| 商談ステージ・ヨミ (8.3/8.4) | `lib/constants.ts`(基準確度つき) |
| CATORCEマスタ (8.1/8.2) | seed として投入(ハードコードしない方針 6.2) |
| マルチテナント (6章) | 全テーブルに `tenant_id` |
| 権限 (11章) / RLS (14章) | Supabase RLS(`0002`/`0004`)。外部営業は自分の担当案件のみ・全顧客リスト非表示 |
| 売上予測 (9.9) | `lib/forecast.ts` `weighted = amount × probability / 100` |
| 週次レビュー (9.10/15.5) | `app/reviews/weekly` 危険案件・クロージング対象・施策 |

## 未実装(後続フェーズ・要件7.3 / 16章)

Gmail/Calendar連携、Stripe課金、CSV入出力、高度なAI売上予測、AIによる商談メモ構造化・
受注確度診断・週次レポート生成(商談詳細にAI診断のプレースホルダーを配置済み)。

---

## スクリプト

```bash
npm run dev        # 開発サーバ
npm run build      # 本番ビルド
npm run start      # 本番起動
npm run typecheck  # 型チェック
```
