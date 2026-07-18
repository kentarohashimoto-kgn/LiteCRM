# デザインガイド（CATORCE Sales OS 由来・他システム流用可）

> **目的**: 本システム（CATORCE Sales OS）で確立したデザイン言語を、他システム構築時にも一貫して再利用するための移植可能なリファレンス。
> **出典**: 実コード（`tailwind.config.ts` / `src/app/globals.css` / `src/lib/constants.ts` / `src/components/ui/primitives.tsx`）から抽出した実測値。
> **前提スタック**: Next.js(App Router) + Tailwind CSS。ただしトークン（色・余白・角丸・影）とパターンはフレームワーク非依存で流用できる。

---

## 0. デザイン原則

- **目指す印象**: 信頼できる / わかりやすい / 実務に強い / AIを現場で使える
- **配色比率の黄金律**: **白・グレー 70% / ティール 20% / オレンジ 10%**。この比率を崩さないことがブランドの一貫性の核。
- **色は意味を持たせて使う**: ブランド＝ティール、行動喚起・強調＝オレンジ。多色化しない。
- **数字は主役**: 経営・実務ダッシュボードでは数値を大きく（`tabular-nums`で桁揃え）、単位は小さく添える。
- **操作に手応え**: すべてのボタンは押下で軽く縮む。完了アクションは達成感の演出（ポップ／チェック描画）で行動を促す。
- **壊れないUI**: 角丸・やわらかい影・広い余白で圧を減らし、情報密度が高くても読める。

---

## 1. カラートークン

### 1.1 ブランド／基盤カラー（実測 HEX）

| 役割 | トークン名 | HEX | 用途 |
|---|---|---|---|
| Primary Teal | `teal` / `teal.primary` | `#008C8C` | ブランド主色。アクティブ状態・主要ボタン・進捗バー |
| Deep Teal | `teal.deep` | `#006C6A` | ホバー・見出し文字・強調テキスト |
| Light Teal | `teal.light` | `#DDF3F0` | 選択背景・ホバー地色・淡いバッジ |
| Accent Orange | `accent` / `accent.orange` | `#F59A2A` | 行動喚起・強調数値・重要ボタン（使いすぎない=全体の10%） |
| Ink (Dark Gray) | `ink` / `ink.dark` | `#273A3A` | 本文テキスト（真っ黒を避け、青緑寄りの濃灰） |
| Soft Gray (Mist) | `mist` / `mist.soft` | `#F4F6F6` | 画面背景・淡い区切り・トラック |

**テキストの濃淡は`ink`の透過で作る**（真っ黒を使わない）:
`text-ink`（本文）/ `text-ink/70`（副次）/ `text-ink/50`（補助）/ `text-ink/40`（プレースホルダ・空状態）/ `text-ink/30`（最も淡い）。

### 1.2 カテゴリ配色（プロジェクト・ラベル・タグの識別色）

固定8色。「点(dot)／塗り(bg)／淡地(soft)／文字(text)／リング(ring)」の5面をセットで持つ。任意の分類対象に割り当てる。

| key | 名称 | dot/bg | soft(淡地) | text |
|---|---|---|---|---|
| `teal` | ティール | `#008C8C` | `teal-light` | `teal-deep` |
| `orange` | オレンジ | `accent-orange` | `orange-50` | `orange-600` |
| `violet` | バイオレット | `violet-500` | `violet-50` | `violet-600` |
| `rose` | ローズ | `rose-500` | `rose-50` | `rose-600` |
| `amber` | アンバー | `amber-500` | `amber-50` | `amber-700` |
| `sky` | スカイ | `sky-500` | `sky-50` | `sky-600` |
| `lime` | ライム | `lime-500` | `lime-50` | `lime-700` |
| `slate` | スレート | `slate-400/500` | `slate-100` | `slate-600` |

### 1.3 状態・トーンの色

| 状態 | 色 | 使用例 |
|---|---|---|
| 危険・超過・失注 | `rose-*`（赤系） | 期限切れ、削除、優先度「高」 |
| 注意・当日・進行 | `accent-orange` / `amber-*` | 今日が期日、警告 |
| 正常・ブランド | `teal-*` | 完了、選択、進捗 |
| 中立・無効 | `slate-*` / `ink/40` | 未設定、無効、プレースホルダ |

優先度トーン: `high→rose` / `middle→orange` / `low→teal`。

---

## 2. タイポグラフィ

- **フォント**: 日本語システムフォント優先（`next/font`は使わず、OSネイティブで軽量・高速表示）。
  ```
  "Hiragino Kaku Gothic ProN", "Hiragino Sans", system-ui, -apple-system,
  BlinkMacSystemFont, "Meiryo", sans-serif
  ```
- **文字詰め**: `font-feature-settings: "palt"`（日本語の約物アキを詰めて可読性向上）＋`-webkit-font-smoothing: antialiased`。
- **数値**: 金額・件数・日付は必ず `tabular-nums`（等幅数字）で桁を揃える。

### スケール（実運用の目安）
| 用途 | クラス例 |
|---|---|
| ページ見出し | `text-xl font-bold text-ink` |
| セクション見出し | `text-sm font-bold text-teal-deep` |
| 強調数値(KPI) | `text-3xl font-bold tabular-nums tracking-tight` |
| 本文 | `text-sm text-ink`（副次は `text-ink/70`） |
| 補助・キャプション | `text-xs text-ink/50` / `text-[11px]` / `text-[10px]` |
| ラベル(フォーム) | `text-xs font-semibold text-ink/60` |

---

## 3. 形状トークン（角丸・影・余白）

| トークン | 値 | 用途 |
|---|---|---|
| 角丸 `rounded-xl` | `0.875rem` | ボタン・入力・小カード |
| 角丸 `rounded-2xl` | `1.125rem` | カード・パネル・ボード列 |
| 角丸 `rounded-full` | 全円 | pill・アバター・チェックボックス |
| 影 `shadow-card` | `0 1px 2px rgba(39,58,58,.04), 0 4px 16px rgba(39,58,58,.06)` | カードのやわらかい浮き |
| 枠線 | `border border-black/[0.04]`〜`/10` | ほぼ透明の極薄枠で面を分離 |
| カード内余白 | `p-5`（`.card-pad`） | 情報に余白を持たせる |

**影は「濃さ」ではなく「広がり」で軽さを出す**（`ink`色ベースの淡い二段影）。

---

## 4. コンポーネントパターン

以下は `globals.css` の `@layer components` で定義済みの再利用クラス。他システムへは §7 の丸ごとコピーで移植できる。

### ボタン `.btn` 系
- `.btn-primary` — ティール塗り／ホバーで`teal-deep`。主要操作。
- `.btn-accent` — オレンジ塗り。最重要の行動喚起（1画面に1つが目安）。
- `.btn-ghost` — 白地＋極薄枠。副次操作。
- 全ボタン共通: 押下で `scale(0.97)`、処理中は `cursor: progress` ＋ 薄く（`opacity .65`）。

### カード／セクション
- `.card` — 白背景＋`shadow-card`＋極薄枠＋`rounded-2xl`。面の基本単位。
- `Section` — カード＋上部に見出し帯（`section-title`＋区切り線）＋本文`p-5`。

### 入力 `.input` / ラベル `.label`
- `.input` — 白地・`rounded-xl`・極薄枠。フォーカスで枠が`teal-primary`＋`ring-2 ring-teal-light`。
- `.label` — フォーム項目名。`text-xs font-semibold text-ink/60`。

### バッジ `.pill`
- `rounded-full`の小ラベル。状態色（soft地＋text）と組み合わせる。例: `pill bg-teal-light text-teal-deep`。

### タブ／セグメント `.seg`
- ビュー切替。`.seg-on`（白地＋`teal-deep`＋影で浮かせる）/ `.seg-off`（淡色）。
- コンテナは `bg-mist-soft p-1 rounded-xl` でトグル群を囲う。

### ナビゲーション `.nav-link`
- 既定は`text-ink/70`、ホバーで`teal-light`地＋`teal-deep`。
- `.nav-link-active` — `teal-primary`塗り＋白文字。

### テーブル `.th` / `.td` / `.row-hover`
- 見出しは`text-xs font-semibold text-ink/50`、セルは`text-sm text-ink/90`。行ホバーは`teal-light/40`。
- 大きな表は `.sticky-grid`（見出し固定＋先頭列固定＋右端操作列固定＋上部同期スクロールバー）を使い、横に広い実務データを画面内で扱う。

### ボード（かんばん）
- 列 `.task-col` — `w-72` 固定幅、`bg-mist-soft/60`、`rounded-2xl`。
- カード `.task-card` — 白地・`rounded-xl`・ホバーで浮上（`-translate-y-0.5`＋影増）、掴めるカーソル（`cursor-grab`）。

### チェックボックス（達成感重視）
- `.task-check` — 円形・ホバーで拡大（`scale-110`）・押下で縮小。完了は`teal-primary`塗り＋チェック描画アニメ。

### アバター
- イニシャル表示の円。背景色はユーザー固有色（既定`#008C8C`）。`initials()`で頭文字生成。

### 進捗バー
- トラック`bg-mist-soft`＋フィル`teal-primary`（または強調時`accent-orange`）。角丸`full`。

### KPIカード（StatCard）
- ラベル（小）→ 数値（`text-3xl` 大・`tabular-nums`）→ 単位（小）→ 補足。強調時は数値をオレンジに。

---

## 5. モーション・インタラクション

| 場面 | 演出 | 実装 |
|---|---|---|
| ボタン押下 | `scale(0.97)` 80ms | base層で全button共通 |
| チェック完了 | 円がポップ→チェック線が描かれる→行が一瞬ティールに光る | `task-check-pop` / `checkmark-draw` / `task-row-complete` |
| ドロワー出現 | 右から24pxスライドイン | `slidein` 0.2s |
| 全画面フィードバック | スピナー(ティールリング)→完了ポップ→リング拡散／失敗はシェイク | `.fb-*` 一式 |

- **原則**: アニメは短く（80〜380ms）、目的は「状態変化を気づかせる」こと。装飾のための長い動きは避ける。
- **アクセシビリティ**: `@media (prefers-reduced-motion: reduce)` で全アニメを停止（実装済み）。必ず踏襲する。

---

## 6. レイアウト指針

- 背景は常に `bg-mist-soft`（白ではなくごく淡いグレー）。その上に白い`.card`を浮かせて情報を面で区切る。
- ページ先頭は `PageHeader`（`text-xl`見出し＋`text-sm text-ink/50`サブ＋右に主アクション）。
- 情報密度が高い実務画面でも、カード単位・広い余白・淡い枠線で「読める密度」を保つ。
- 空状態は責めない: `EmptyState` は `text-center py-12 text-ink/40` で静かに案内。

---

## 7. 移植用スニペット（コピーして他システムへ）

### 7.1 Tailwind テーマ拡張（`tailwind.config.ts`）
```ts
theme: {
  extend: {
    colors: {
      teal:   { DEFAULT: "#008C8C", primary: "#008C8C", deep: "#006C6A", light: "#DDF3F0" },
      accent: { DEFAULT: "#F59A2A", orange: "#F59A2A" },
      ink:    { DEFAULT: "#273A3A", dark: "#273A3A" },
      mist:   { DEFAULT: "#F4F6F6", soft: "#F4F6F6" },
    },
    fontFamily: {
      sans: ["var(--font-sans)", "-apple-system", "BlinkMacSystemFont",
             "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Meiryo", "sans-serif"],
    },
    boxShadow: { card: "0 1px 2px rgba(39,58,58,0.04), 0 4px 16px rgba(39,58,58,0.06)" },
    borderRadius: { xl: "0.875rem", "2xl": "1.125rem" },
  },
}
```

### 7.2 グローバル基盤（`globals.css` 抜粋）
```css
:root { --font-sans: "Hiragino Kaku Gothic ProN", "Hiragino Sans", system-ui, sans-serif; }

@layer base {
  button:active:not(:disabled) { transform: scale(0.97); transition: transform 80ms ease; }
  button:disabled { cursor: progress; opacity: 0.65; }
  html, body { @apply bg-mist-soft text-ink; -webkit-font-smoothing: antialiased; font-feature-settings: "palt"; }
}

@layer components {
  .card    { @apply rounded-2xl bg-white shadow-card border border-black/[0.04]; }
  .card-pad{ @apply p-5; }
  .btn     { @apply inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50; }
  .btn-primary { @apply btn bg-teal-primary text-white hover:bg-teal-deep; }
  .btn-accent  { @apply btn bg-accent-orange text-white hover:brightness-95; }
  .btn-ghost   { @apply btn bg-white text-ink/80 border border-black/10 hover:bg-mist-soft; }
  .input   { @apply w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-teal-primary focus:ring-2 focus:ring-teal-light; }
  .label   { @apply block text-xs font-semibold text-ink/60 mb-1; }
  .pill    { @apply inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold; }
  .seg     { @apply inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors; }
  .seg-on  { @apply bg-white text-teal-deep shadow-sm; }
  .seg-off { @apply text-ink/50 hover:text-ink/80; }
}
```
（テーブル固定・タスクボード・完了演出などフル定義は本リポジトリの `src/app/globals.css` を参照。）

---

## 8. チェックリスト（他システムで踏襲すべき最低限）

- [ ] 背景は`mist-soft`、面は白`card`＋やわらかい二段影
- [ ] 配色比率 白/グレー70・ティール20・オレンジ10 を守る
- [ ] 主色ティール／行動喚起オレンジの役割を混在させない
- [ ] テキストは`ink`＋透過で濃淡（真っ黒は使わない）
- [ ] 数値は`tabular-nums`で桁揃え、KPIは大きく単位は小さく
- [ ] 角丸は`xl`(小物)/`2xl`(面)、枠線は極薄
- [ ] ボタンは押下で縮む・処理中は`progress`カーソル
- [ ] 完了アクションに達成感の演出、ただし`prefers-reduced-motion`で停止
- [ ] カテゴリ識別は固定8色パレット（dot/bg/soft/text/ringの5面セット）
- [ ] 日本語は`palt`＋システムフォントで軽量・詰め表示

---

_本ガイドは実装から抽出した実測値ベース。トークンを変えたい場合は §7 の一箇所（テーマ拡張）を差し替えれば全体に波及する設計。_
