# 検証基準書（実行成果の合否判定）

> **使い方**: 実行AI（Sonnet）は各WO完了時に本書の該当節を自己実行し、結果を完了報告に含める。
> ユーザー（発注者）は「ユーザー検収」列の項目だけ手動確認すればよい。
> **不合格が1つでもあれば当該WOは未完了**。修正して再検証する。

---

## 1. 全WO共通ゲート（毎回必須）

| ID | ゲート | 方法 | 合格基準 |
|---|---|---|---|
| G-1 | ビルド | `npm run build` | "Compiled successfully" |
| G-2 | 型 | `npx tsc --noEmit` | エラー0 |
| G-3 | DBセキュリティ | `get_advisors(type=security)` | **ERROR=0**、WARNが着手前より増えていない |
| G-4 | RLS完全性 | 新設テーブルに対し `select relrowsecurity, (select count(*) from pg_policies where tablename=<t>)` | RLS有効かつポリシー≥4（読取専用テーブルは≥1） |
| G-5 | RPC性能 | GUARDRAILS §3-3 の認証コンテキストで `explain analyze` | 新設RPCすべて **500ms以内**（8s上限に対し16倍マージン） |
| G-6 | 権限 | 新設SECURITY DEFINER関数の `has_function_privilege('anon', ...)` | すべて false |
| G-7 | ブランチ | `git branch --show-current` | `claude/keen-mayer-yJCVC` のみにpush |
| G-8 | 回帰 | 下記§3スモークリスト | 全ページHTTP 200・主要数値が変化していない（変更対象を除く） |
| G-9 | migration整合 | 適用済みRPC/DDLと `supabase/migrations/*.sql` の内容一致 | 乖離なし（適用したがコミットしていないSQLが無い） |

## 2. パフォーマンス予算（WO-00以降、常時維持）

| 対象 | 予算 | 測定方法 |
|---|---|---|
| ページのデータ取得合計 | < 800ms | `[perf]` ログ（withTiming） |
| 一覧1ページのDB転送量 | < 300KB | フェッチャで取得行数×概算 or ログ |
| 一覧の取得件数 | ≤ 200行/リクエスト | コードレビュー（range指定の確認） |
| `getWorkspace()` 利用ページ数 | 単調減少（増加禁止） | `grep -rl "getWorkspace\b" src/app --include=page.tsx \| wc -l` を毎WO報告 |

## 3. 回帰スモークリスト（G-8の対象）

主要13ページ: `/app/dashboard` `/app/opportunities` `/app/opportunities/[実在id]` `/app/accounts` `/app/leads` `/app/activities` `/app/forecast` `/app/tasks` `/app/analytics/roi` `/app/analytics/exhibition-roi` `/app/analytics/seminar-followup` `/app/targets` `/app/settings`
- 確認: エラーなく描画 / 件数・合計金額など**基準値**が前回報告と一致（変更したページは新旧差分を説明）。
- 基準値の初期化: WO-00着手時に「案件総数・open件数・won合計・リード総数・今期売上実績」をSQLで取得し `docs/exec-plan/BASELINE_NUMBERS.md` に記録（以後の照合原本）。

## 4. WO別受入テスト（要約 — 詳細は各WO末尾の受入基準）

| WO | 重点検証（自動/SQL） | ユーザー検収（手動・5分以内） |
|---|---|---|
| 00 | CAS競合テスト、前後性能比較値、getWorkspace残数 | 案件一覧が体感で速くなった／ページングが動く |
| 01 | ヨミ連動更新のSQL確認、必須バリデーション拒否 | ボードでカードを動かしてヨミが変わる／2.Bで金額必須が効く |
| 02 | 活動→案件・顧客の自動更新、7日タスク生成 | 活動登録が5分以内で完了する |
| 03 | sales_alerts件数とSQL直接集計の一致、hq_dashboard 1RPC | サイドバーが≦16項目／マイDBに「今日の次回AC」 |
| 04 | transition自動作成・重複防止、ヘルス判定4状態 | 研修受注→フォロータスクが自動で現れる |
| 05 | 分類別タスク生成数・due、承認ブロックのON/OFF | 分類登録→タスクが並ぶ／本部で差戻しできる |
| 06 | スコア境界値（79/80、64/65）、rescore性能、手動rank保護 | S判定リードに期限が付く／商談化ボタンで案件になる |
| 07 | キー未設定の安全動作、バンドル漏洩チェック、ai_runs記録 | 議事録貼付→要約→フィールド反映が動く |
| 08 | 取込後の突合SQL4点 | 件数・受注額がNotionと一致／取込が管理者ツールへ移動 |

## 5. データ整合性チェック（WO-01, 02, 04, 05, 06 完了時に実行）

```sql
-- A. 孤児レコード（0件であること）
select 'activities' t, count(*) from activities a where a.opportunity_id is not null
  and not exists (select 1 from opportunities o where o.id=a.opportunity_id)
union all
select 'transitions', count(*) from transitions tr
  where not exists (select 1 from opportunities o where o.id=tr.original_opportunity_id)
union all
select 'sales_schedules', count(*) from sales_schedules s
  where not exists (select 1 from opportunities o where o.id=s.opportunity_id);

-- B. open案件の次回AC設定率（WO-02以降、上昇トレンドであること。報告に数値）
select count(*) filter (where next_action_date is not null)::float / nullif(count(*),0)
from opportunities where status='open';

-- C. tenant_id null（0件であること。全業務テーブル対象）
```
（テーブル未作成のWO段階では該当行をスキップ）

## 6. 完了報告テンプレート（実行AIはこの形式で報告）

```markdown
## WO-0X 完了報告
### 変更概要
（3行以内。ユーザー価値ベースで）
### 変更ファイル
（新規/変更のパス一覧）
### 適用マイグレーション
（番号と要旨。get_advisors結果: ERROR=0 / WARN増減）
### 検証結果
- G-1〜G-9: すべて合格（不合格→修正した経緯があれば記載）
- V-0X 各項目: ✅/❌ と根拠（SQL結果・実測ms・スクリーン挙動）
- 性能予算: 対象ページの実測値
- getWorkspace残数: N (前回: M)
### スコープ外にしたこと・判断が必要なこと
（あれば。なぜ外したか1行ずつ）
### 次のWOへの引き継ぎ
```

## 7. 差し戻し基準（ユーザー向けガイド）

以下のどれかに該当したら、そのWOは差し戻してよい:
1. 完了報告に**実測値・SQL結果の記載がない**（「動くはず」は不合格）
2. 既存画面の数値が説明なく変わった
3. 新機能がGUARDRAILS違反（RLS無し、anon実行可、getWorkspace新規利用等）
4. 体感レスポンスが悪化した
5. 日本語UIが崩れている・エラーメッセージが英語のまま
