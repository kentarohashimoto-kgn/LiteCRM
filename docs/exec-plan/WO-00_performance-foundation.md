# WO-00: 性能・同時編集の土台

> 先に `GUARDRAILS.md` と `MASTER_PLAN.md` §2,§4 を読むこと。
> **目的**: 「遅い」の根本（全データ一括取得）を解消し、複数営業の同時編集を安全にする。以後の全WOの土台。

## スコープ
1. 部分取得フェッチャの整備と主要ページの移行
2. 一覧のサーバーサイドページング
3. 楽観ロック（updated_at CAS）
4. `src/server/actions.ts`（1,894行）のドメイン分割
5. 簡易計測

## 非スコープ
- IA変更・新機能（WO-01以降）。見た目は変えない。

## 実装詳細

### 1. 部分取得フェッチャ
- `src/lib/data/page-data.ts`（新規）に、ページ単位の専用フェッチャを追加していく。方針:
  - マスタ系（profiles/lead_sources/campaigns/products/marketing_channels）は軽いので1RPC or 個別selectでまとめて取得する `getMasters()` を作る。
  - 大物（opportunities/meetings/activities/leads）は**ページが使う範囲だけ** `.select(必要列).eq/gte/lte/range()` で取得。
- 移行対象（`getWorkspace()`利用16ページのうち、重くかつ高頻度なもの優先）:
  1. `/app/opportunities`（一覧: ページング+絞り込みへ。詳細ページは対象案件+関連のみ取得に変更）
  2. `/app/activities`（期間フィルタ+ページング）
  3. `/app/accounts`（一覧は集計列を持たない軽量select、詳細で関連取得）
  4. `/app/contacts`
  5. `/app/forecast`（必要なのはopportunities+targets+billing+revenue_forecasts。meetings/activities等は不要）
- 残りの`getWorkspace()`ページは触らない（回帰リスク低減。後続WOで画面ごと再構築される）。
- `getWorkspace()` に `@deprecated 新規利用禁止(GUARDRAILS §4-1)` のJSDocを付ける。

### 2. サーバーサイドページング
- 対象: 案件一覧・活動一覧・リード一覧（リードは既存実装がRPC集計ならページングのみ確認）。
- 仕様: `?page=1&per=50`（URLパラメータ、既定50、最大200）。`.range((page-1)*per, page*per-1)` + `count: "exact"` で総件数表示。絞込条件（担当/ヨミ/ステータス/期間/検索語）もURLパラメータ化（共有可能なURL＝保存ビューの土台）。
- 検索は `ilike` + 既存インデックス確認。必要なら `create index ... on opportunities (tenant_id, status)` 等を migration 0042 で追加（`explain analyze`で効果確認してから）。

### 3. 楽観ロック（CAS）
- `updateOpportunityAction` / `updateLeadAction` / `updateMeetingAction` / 今後の全update系に共通適用:
  - クライアントは読込時の `updated_at` を hidden で送る。
  - `update ... .eq("id", id).eq("updated_at", clientUpdatedAt)` で0行更新なら**競合エラー**を返し、UIは「他のメンバーが更新しました。再読み込みしてください」を表示（`useFormState`または返り値ハンドリング）。
  - 共通ヘルパー `casUpdate(table, id, clientUpdatedAt, patch)` を `src/server/actions/_helpers.ts` に作る。
- 注意: `set_updated_at`トリガーがあるため書込み成功時は新updated_atが返る（`.select("updated_at").single()`で回収しフォームを更新）。

### 4. actions分割
- `src/server/actions/` に分割: `opportunities.ts` / `accounts.ts` / `leads.ts` / `activities.ts` / `imports.ts` / `analytics-masters.ts` / `reviews.ts` / `misc.ts` / `_helpers.ts`。
- `src/server/actions.ts` は `export * from "./actions/..."` のハブにして既存importを壊さない。
- 挙動変更はしない（純粋な移動）。ビルドで検証。

### 5. 計測
- `src/lib/perf.ts`: `withTiming(label, fn)` — 実行msを `console.log("[perf]", label, ms)`（本番はVercelログで確認可）。主要ページのフェッチャに巻く。
- ベースライン計測: 移行**前後**で `/app/opportunities` `/app/forecast` `/app/dashboard` のレンダー時間をログから記録し、完了報告に前後比較を含める。

## DB変更
- migration 0042（必要な場合のみ）: 一覧絞込用インデックス。例:
  `create index if not exists idx_opps_tenant_status on public.opportunities(tenant_id, status);`
  `create index if not exists idx_activities_tenant_date on public.activities(tenant_id, activity_at desc);`
  ※ `explain analyze` で使用されることを確認してから採用。

## 受入基準（VERIFICATION V-00）
- [ ] 案件一覧: 50件/ページで表示、総件数表示、絞込がURLに反映される
- [ ] 移行5ページが `getWorkspace()` を参照していない（grepで確認）
- [ ] 2つのブラウザ相当で同一案件を編集→後勝ち側にエラーが表示され、上書き消失しない
- [ ] `npm run build` / `npx tsc --noEmit` 成功
- [ ] 前後比較で対象ページのサーバー処理時間が短縮（報告に数値）
- [ ] `get_advisors(security)` ERROR=0
