# CATORCE Sales OS

**営業活動を記録するだけのCRMから、未来の売上を作る営業OSへ。**

株式会社カトルセ向けに開発した AI営業OS / CRM / SFA / 売上予測アプリです。
商談・ヨミ・商品・流入経路・営業担当を一元管理し、毎週の営業会議で
**今月の着地と今週打つべき施策**まで導きます。将来の BtoB SaaS 外販を見据え、
最初からマルチテナント構成で設計しています。

> 要件定義書: `CATORCE Sales OS 要件定義書` に準拠。

---

## 特長

- 📊 **ダッシュボード** — 今月の目標 / Commit / Best Case / Weighted / Gap を一目で
- 🗓 **週次レビュー画面（最重要）** — 「確認」で終わらせず、今週の打ち手を決める会議画面
- 🎯 **商談管理(SFA)** — 金額・ステージ・ヨミ・確度・次アクション・リスクを管理
- 🔮 **売上予測** — 今月 / 来月 / 四半期 / 12ヶ月ローリング（`weighted = 金額 × 確度`）
- 🚨 **危険案件の自動検知** — 放置案件・次アクション未設定・提案後フォロー漏れ
- 📈 **分析** — 営業マン別 / 商品別 / 流入経路別の成果分析
- 🔐 **ロール別アクセス制御** — 外部営業は自分の担当案件のみ（RLS相当）
- 🏢 **マルチテナント** — CATORCEも1テナント。固有情報はseed/設定として保持

デザインは **カトルセ提案書デザインガイド**（Primary Teal `#008C8C` / Accent Orange `#F59A2A`、
配色比率 白・グレー70% / ティール20% / オレンジ10%、数字は大きく単位は小さく）に準拠しています。

---

## 技術スタック

| 領域 | 技術 |
|---|---|
| フレームワーク | Next.js 14 (App Router) / React 18 / TypeScript |
| UI | Tailwind CSS（CATORCEデザイントークン） |
| グラフ | Recharts |
| アイコン | lucide-react |
| バックエンド(本番) | Supabase (PostgreSQL + Auth + RLS) |

---

## クイックスタート（デモモード）

Supabase の設定なしで、すぐに動かせます。CATORCE初期テンプレート + サンプル商談データが
メモリ上に投入された状態で起動します。

```bash
npm install
npm run dev
# http://localhost:3000 を開く
```

`/login` で **ログインユーザーを選択**できます。ロールごとに見える範囲が変わります。

| ユーザー | ロール | 見える範囲 |
|---|---|---|
| 橋本 健太郎 | owner（代表） | テナント全件 |
| 佐藤 美咲 | sales_manager（Sales Ops） | テナント全件 |
| 田中 亮 / 鈴木 彩 / 山本 直樹 | external_sales（外部営業） | 自分の担当案件のみ |
| 井上 拓也 | partner（パートナー） | 自分の担当案件のみ |

画面右上の「表示ユーザー」セレクタでいつでも切り替えられます（権限の見え方を検証するため）。

---

## 本番モード（Supabase）

`.env.local` に Supabase の認証情報を設定すると本番構成に切り替えられます。

```bash
cp .env.example .env.local
# NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY などを設定
```

### DBセットアップ

```bash
# Supabase CLI を利用する場合
supabase db reset           # マイグレーション + seed を適用
# もしくは個別に
psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
psql "$DATABASE_URL" -f supabase/migrations/0002_rls.sql
psql "$DATABASE_URL" -f supabase/seed.sql
```

- `0001_init.sql` … 全テーブル定義（tenant_id付き）、インデックス、updated_at / ステージ履歴トリガ
- `0002_rls.sql` … Row Level Security（要件14章。テナント分離 + ロール別参照/編集）
- `seed.sql` … CATORCE初期テンプレート（流入経路・商材・売上目標）

> メンバー（memberships）は Supabase Auth でユーザー作成後に投入します（`seed.sql` 末尾コメント参照）。

データアクセスは `src/lib/data/store.ts` のリポジトリ層に集約しています。
Supabase クライアントへ差し替える際は、各リポジトリ関数の中身を入れ替えるだけで
画面側の変更は不要な構成です。

---

## ディレクトリ構成

```
src/
  app/
    login/                         ログイン(ユーザー選択)
    app/
      dashboard/                   ダッシュボード
      reviews/weekly/              週次レビュー(最重要画面)
      opportunities/               商談 一覧 / 詳細 / 新規
      forecast/                    売上予測
      accounts/  contacts/  leads/ 顧客 / 担当者 / リード
      tasks/  activities/          タスク / 活動履歴
      analytics/                   営業マン別 / 商品別 / 流入経路別
      settings/                    設定(メンバー・商材・流入・ステージ)
  components/
    ui/  layout/  charts/  opportunities/
  lib/
    types.ts        ドメイン型(要件13章対応)
    constants.ts    ステージ/ヨミ/ロール/CATORCEマスタ(設定データ)
    forecast.ts     売上予測ロジック
    risk.ts         危険案件/放置案件の検知
    analytics.ts    営業マン別/商品別/流入経路別分析
    session.ts      認証コンテキスト
    data/seed.ts    CATORCE初期テンプレート + サンプルデータ
    data/store.ts   リポジトリ層(RLS相当のスコープを実装)
  server/
    actions.ts      Server Actions(作成/更新/活動/タスク)
supabase/
  migrations/       本番スキーマ + RLS
  seed.sql          CATORCE初期テンプレート(SQL)
```

---

## 要件定義書との対応

| 要件 | 実装 |
|---|---|
| MVP P0/P1機能 (7.2) | ✅ 顧客/担当者/リード/商談/活動/タスク/予測/放置検知/週次レビュー/各種分析 |
| 商談ステージ・ヨミ (8.3/8.4) | `lib/constants.ts`（基準確度つき・将来カスタマイズ可能） |
| CATORCEマスタ (8.1/8.2) | seed として投入（ハードコードしない方針 6.2） |
| マルチテナント (6章) | 全エンティティに `tenant_id`、`store.ts` でテナント分離 |
| 権限 (11章) / RLS (14章) | ロール別スコープ（デモ: `store.ts` / 本番: `0002_rls.sql`） |
| 売上予測 (9.9) | `lib/forecast.ts` `weighted = amount × probability / 100` |
| 週次レビュー (9.10/15.5) | `app/reviews/weekly` 危険案件・クロージング対象・施策 |

## 未実装（後続フェーズ・要件7.3 / 16章）

Gmail/Calendar連携、Stripe課金、CSVインポート/エクスポート、メンバー招待、
高度なAI売上予測、AIによる商談メモ構造化・受注確度診断・週次レポート生成
（商談詳細にはAI診断のプレースホルダーを配置済み）。

---

## スクリプト

```bash
npm run dev        # 開発サーバ
npm run build      # 本番ビルド
npm run start      # 本番起動
npm run typecheck  # 型チェック
```
