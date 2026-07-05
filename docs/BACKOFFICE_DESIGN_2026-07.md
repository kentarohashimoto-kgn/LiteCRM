# バックオフィス業務管理 機能設計（2026-07）

> **目的**: CRM/SFA(営業領域)に加えて、カトルセのバックオフィス業務(事務・人事)を同じ基盤の上で管理し、
> 「納期のある事務作業の抜け漏れゼロ」「採用〜稼働の人材情報の一元化」を実現する。
> **前提**: 既存の通知基盤(A-1ベル/Slack/cron)・タスク・WBS的な考え方・RLS基盤を最大限再利用する。

---

## 1. 要望の整理

| # | 要望 | 本質的な課題 | モジュール名 |
|---|---|---|---|
| R1 | AI研修の助成金フォロー(事前説明会/事前申請=研修1ヶ月前/実績報告=研修後2ヶ月)を納期通りに | **期日つき定型マイルストーンの進捗管理とリマインド** | BO-1 助成金トラッカー |
| R2 | 研修受講会社への事例化・インタビューができているか | **受注→事例化のパイプライン管理(実施率の見える化)** | BO-2 事例・インタビュー管理 |
| R3 | 研修後アンケートの分析(講師別/研修種類別/受講者層別) | **アンケートデータの構造化取込と多軸集計** | BO-3 講師アンケート分析 |
| R4 | 展示会の事前作業(人員アサイン/出展サイト登録等)をプリセット→確定でWBS自動生成→納期前リマインド | **テンプレート駆動のWBS自動生成と期日管理** | BO-4 展示会準備WBS |
| R5 | 人材タレント(採用〜面接〜稼働中評価、求人案件=クライアント案件/カトルセ人員) | **採用パイプライン＋稼働者台帳＋評価履歴** | BO-5 人材タレント(HR) |
| R0 | 事務・人事だけが見られる領域(営業⇔BOの相互不可視、管理者は全可視) | **領域単位のアクセス制御** | BO-0 権限基盤 |

---

## 2. BO-0 権限設計（最重要・全モジュールの土台）

### 2.1 ロール

既存ロールに **2ロールを追加**する（membershipsは現行のまま流用）。

| ロール | ラベル | 見える領域 |
|---|---|---|
| `back_office` (新規) | 事務 | BO領域(BO-1〜4)のみ。営業領域は不可視 |
| `hr` (新規) | 人事 | BO領域(BO-1〜4)＋人事領域(BO-5) |
| `owner` / `admin` (既存) | 代表/管理者 | 全領域(営業＋BO＋人事) |
| 営業系ロール (既存) | sales_manager, sales_rep 等 | 営業領域のみ。BO/人事領域は不可視 |

- 「事務」と「人事」を分けるのは、**人材タレント(給与・評価に近い情報)は人事と管理者のみ**が扱うべきため。
- 既存の `finance`(経理)・`delivery`(講師/PM) は現行定義のまま。将来、経理をBO領域へ含めるかは運用を見て判断(未確定事項へ)。

### 2.2 アクセス制御の実装方針(3層)

| 層 | 仕組み | 内容 |
|---|---|---|
| ① DB(RLS) | SQLヘルパー追加 | `is_backoffice(tenant)` = role in ('back_office','hr','owner','admin')、`is_hr(tenant)` = role in ('hr','owner','admin')。**BO系新テーブルは全てこのポリシーで保護**(UIだけの出し分けにしない) |
| ② 営業データの遮断 | 既存RLSがそのまま効く | 既存の `can_view_all()` に新ロールを**追加しない**。leads/opportunities/accounts等は「全件閲覧ロール or 自分担当」なので、BOロールは自動的に0件になる(変更不要)。secdef RPC(dashboard_metrics等)も同関数を使うため同様に0件 |
| ③ 画面/ナビ | レイアウトガード | サイドバーをロールで出し分け(営業ナビ⇔BOナビ)。`/app/bo/*` `/app/hr/*` はページ先頭で `requireBackofficeCtx()` / `requireHrCtx()`(権限なしはトップへリダイレクト)。逆に営業ページはBOロールならBOトップへリダイレクト |

### 2.3 営業データへの「必要最小限の橋」

BO業務は「どの会社の研修がいつあるか」を知る必要があるが、金額・ヨミ・商談内容は見せない。
→ **secdef RPC `bo_training_deals()`** を新設し、受注済みの研修案件から**許可列のみ**
(案件ID/会社名/案件名/研修実施日/受注日)を返す。BO-1/BO-2はこのRPC経由でのみ案件と連携する。
展示会も同様に `bo_exhibitions()`(campaigns/exhibition_eventsから名称・会期のみ)。

> 逆方向(営業→BO)は橋を作らない。営業が知るべきBO情報(例: 助成金の申請状況)が出てきたら、
> 案件詳細に「ステータスのみ」を表示する読み取りRPCを個別に追加検討。

---

## 3. モジュール別 機能設計

### BO-1 助成金トラッカー（AI研修のフォローと事前）

**目的**: 助成金あり研修の3つの納期(事前説明会/事前申請=研修1ヶ月前/実績報告=研修終了後2ヶ月)を絶対に落とさない。

**主要機能**
1. 研修案件の登録: `bo_training_deals()` から研修案件を選択(または手入力)して「助成金案件」を作成。研修実施日(開始/終了)・助成金種別・担当事務を設定
2. マイルストーン自動生成: 登録時に3件を自動作成
   - 事前説明会(期日=手動設定。既定: 研修開始6週間前)
   - 助成金の事前申請(期日=**研修開始日−1ヶ月**)
   - 助成金の実績報告(期日=**研修終了日＋2ヶ月**)
   - ※助成金種別ごとに期日ルール・追加マイルストーンをマスタで持てる構造(例: 計画届/支給申請)
3. ボード画面: 「期限超過(赤)/7日以内(橙)/対応中/完了」で全件を俯瞰。案件別の進捗バー
4. リマインド: 期日7日前・3日前・当日・超過を毎朝のcronで担当者へベル＋Slack(既存notifications/digest基盤に相乗り)
5. 完了記録: 実施日・提出番号・メモ・添付(既存attachmentsを`target_type='subsidy_case'`に拡張)

**データモデル**
```
subsidy_programs(助成金種別マスタ)  id, name(例:人材開発支援助成金), milestone_rules jsonb
subsidy_cases    id, tenant_id, opportunity_id(null可), account_name, training_name,
                 training_start_date, training_end_date, program_id, assignee_user_id,
                 status(open/done/cancelled), notes, created_at...
subsidy_milestones id, case_id, kind(briefing/pre_application/result_report/...), label,
                 due_date, status(todo/done/na), completed_at, completed_by, memo
```
RLS: is_backoffice。

**画面**: `/app/bo/subsidies`(一覧+期日ボード) / `/app/bo/subsidies/[id]`(詳細・マイルストーン消込)

---

### BO-2 事例・インタビュー管理

**目的**: 研修受講会社の事例化率を管理指標にする(「できているか？」に数字で答える)。

**主要機能**
1. 対象の自動リストアップ: `bo_training_deals()` の受注研修を母数として一覧化。各社に事例化ステータスを付与
2. ステータスパイプライン: 未打診 → 打診中 → 承諾 → 取材済 → 記事作成中 → 公開 ／ 辞退・対象外
3. 管理項目: 担当者、打診日、取材予定日、公開URL、承諾書の添付、次アクション日(リマインド連動)
4. KPI: 事例化率(公開/母数)、ステータス別件数、四半期推移

**データモデル**
```
case_studies  id, tenant_id, opportunity_id(null可), account_name, training_name,
              status, assignee_user_id, approached_at, interview_date, published_url,
              next_action_date, notes, created_at...
```
RLS: is_backoffice。添付は attachments(`target_type='case_study'`)。

**画面**: `/app/bo/cases`(パイプライン表＋KPIカード)

---

### BO-3 講師アンケート分析

**目的**: 研修後アンケートを構造化して蓄積し、講師別・研修種類別・受講者層別で品質を可視化する。

**主要機能**
1. 研修(実施回)の登録: 実施日・研修種類(マスタ)・講師(複数可)・受講企業
2. 回答の取込: CSV/TSVアップロード(既存リード取込のマッピングUIパターンを流用)。設問は「共通コア設問＋自由設問」の2層
   - コア設問(固定列): 総合満足度(5段階)、理解度(5段階)、講師評価(5段階)、推奨度(NPS 0-10)、自由記述
   - 受講者属性: 役職層(経営/管理職/一般)、職種、年代 ※分析軸になるため選択式に正規化
3. 分析画面:
   - 講師別: 平均スコア・回答数・推移(担当研修横断)
   - 研修種類別: スコア比較・自由記述一覧
   - 受講者層別: 役職層×満足度クロス、年代別分布
   - 全体: スコア推移、低評価(≤2)アラート一覧
4. 将来(D-4連携): 自由記述のAI要約・ネガ抽出(ANTHROPIC_API_KEY設定時のみ表示)

**データモデル**
```
training_courses(研修種類マスタ)  id, name, category
instructors(講師マスタ)          id, name, user_id(社内講師なら紐付け), is_external
training_sessions  id, tenant_id, course_id, held_on, account_name, opportunity_id(null可),
                   instructor_ids uuid[], attendee_count
survey_responses2  id, session_id, role_level(exec/manager/staff), job_category, age_band,
                   satisfaction int, understanding int, instructor_score int, nps int,
                   comment text, created_at
```
RLS: is_backoffice(講師本人への開示は将来検討)。
※ 既存 `seminar_responses`(マーケのセミナー)とは目的が異なるため別テーブル。

**画面**: `/app/bo/surveys`(取込+分析タブ: 講師別/種類別/受講者層別)

---

### BO-4 展示会準備WBS（プリセット→自動生成→リマインド）

**目的**: 展示会が確定したら定型タスク群(WBS)を自動展開し、納期前リマインドで事前作業の抜けを防ぐ。

**主要機能**
1. タスクプリセット(テンプレート)管理: 設定画面でCRUD
   - 項目: タスク名、カテゴリ(出展手続/人員/制作物/物流/当日運営)、**期日オフセット(会期初日から−N日)**、既定担当(役割 or ユーザー)、説明
   - 初期プリセット例: 出展管理サイトへの登録(−60日)、ブース仕様提出(−45日)、当日運営人員のアサイン(−30日)、名刺取込体制の確認(−14日)、備品発送(−7日)、朝礼・役割最終確認(−1日)
2. 展示会プロジェクト作成: 展示会名・会期(開始/終了)・会場を登録し「確定」にすると、**テンプレート一式からWBS(期日つきタスク)を自動生成**。会期変更時は未完了タスクの期日を自動再計算
3. 人員アサイン表: 役割(リード獲得要員/フィールドセールス/管理者)×日付でメンバーを割当。**営業メンバーの氏名一覧(profiles)は共有マスタなので参照可**。アサインされた営業本人には通知(ベル/Slack)を送る(※営業はBO画面は見えないが、通知テキストで内容は伝わる)
4. 進捗ボード: カテゴリ別・期日順のWBS。超過/7日以内のハイライト。完了消込
5. リマインド: 期日7日前/3日前/当日/超過に担当者へ通知(既存cron相乗り)
6. 営業側連携: 確定した展示会は既存 `campaigns`(展示会・施策マスタ)にも自動登録し、リード取込・ROI分析(既存機能)と名寄せキー(raw_event)を揃える

**データモデル**
```
expo_task_templates id, tenant_id, name, category, offset_days int(会期初日基準・負数),
                    default_role(lead_gen/field_sales/manager/none), default_assignee uuid,
                    sort_order, active
expo_projects      id, tenant_id, name, starts_on, ends_on, venue, status(planning/confirmed/done/cancelled),
                    campaign_id(既存campaignsへのリンク), notes
expo_tasks         id, project_id, template_id(null可=手動追加), name, category,
                    due_date, assignee_user_id, status(todo/doing/done/na), completed_at, memo
expo_staffing      id, project_id, date, role(lead_gen/field_sales/manager), user_id, memo
```
RLS: is_backoffice(閲覧はowner/adminも)。

**画面**: `/app/bo/expos`(一覧) / `/app/bo/expos/[id]`(WBS＋アサイン表) / テンプレ管理は `/app/bo/expos/templates`

---

### BO-5 人材タレントシステム（人事のみ）

**目的**: 「求人案件(クライアント案件/カトルセ社内)→採用→面接→内定→稼働→評価」を1本の台帳で管理する。

**主要機能**
1. 求人案件管理: 種別=①クライアント案件(顧客先へのアサイン枠) ②カトルセ人員(自社採用)。役割・必要スキル・単価/給与レンジ・状態(募集中/選考中/充足/クローズ)
2. 候補者管理: 流入元(紹介/媒体/エージェント)、応募先求人、ステータスパイプライン
   - 応募 → 書類選考 → 一次面接 → 二次面接 → 最終 → 内定 → 入社/稼働開始 ／ 見送り・辞退
   - 履歴書・職務経歴書の添付(attachments流用)、面接ログ(日時・面接官・評価・所感)
3. タレント台帳(稼働中): 入社/稼働開始で候補者→タレントへ昇格。雇用区分(社員/業務委託/講師)、スキルタグ、現在のアサイン(クライアント案件 or 社内)、稼働率
4. 評価: 評価期間(四半期/半期)ごとに評価レコードを記録。評価者・総合評価(5段階)・項目別(スキル/成果/協働 ※項目はマスタ化)・コメント・次期目標。時系列で推移表示
5. リマインド: 面接前日通知、内定後の入社手続タスク、評価期間の締切通知

**データモデル**
```
job_openings  id, tenant_id, kind(client/internal), title, client_name(kind=client時),
              role_description, skills text[], status, rate_or_salary_note, opened_at, closed_at
candidates    id, tenant_id, name, email, phone, source, job_opening_id, status,
              current_step, next_interview_at, assignee_user_id(採用担当), notes
interviews    id, candidate_id, step(screening/first/second/final), scheduled_at,
              interviewer_user_id, result(pass/fail/hold), score int, notes
talents       id, tenant_id, candidate_id(null可=既存社員), name, employment_type(employee/contractor/instructor),
              user_id(アカウントがあれば), skills text[], current_assignment(client案件名 or 社内), utilization int, joined_on, left_on
talent_reviews id, talent_id, period(例 2026H2), reviewer_user_id, overall int,
              scores jsonb(項目別), comment, goals, created_at
```
RLS: **is_hr のみ**(back_officeも不可)。給与そのものは扱わず「レンジ・メモ」に留める(給与計算は対象外)。

**画面**: `/app/hr/openings` / `/app/hr/candidates`(パイプライン) / `/app/hr/talents`(台帳+評価タブ)

---

## 4. 共通基盤の再利用と追加

| 部品 | 方針 |
|---|---|
| 通知 | 既存 notifications＋毎朝cron に「BO期日チェック」を追加(subsidy_milestones / expo_tasks / interviews / case_studies.next_action_date を横断)。kind='bo_due' |
| 添付 | 既存 attachments の `target_type` に subsidy_case / case_study / candidate 等を追加(checkの拡張のみ) |
| 取込 | BO-3のCSV取込は既存リード取込のマッピングUIを共通化して流用 |
| 変更履歴 | 主要BOテーブル(subsidy_cases, candidates, talent_reviews)にも既存 fn_audit_row トリガーを適用 |
| ゴミ箱 | BOテーブルは物理削除+audit(件数が少なく定型のため)。運用後に必要なら soft delete 拡張 |
| BOダッシュボード | `/app/bo` トップに「今週の期日(全モジュール横断)/超過/今月の事例化率/直近アンケートスコア」を集約 |

## 5. 実装ロードマップ（弾数の続きで管理）

| 弾 | 内容 | 規模感 |
|---|---|---|
| **第7弾 BO基盤** ✅実装済み | BO-0権限(ロール2種+RLSヘルパー+ナビ出し分け+ガード) / `/app/bo`トップ / bo_training_deals・bo_exhibitions RPC / cronのBO期日チェック枠 | M |
| **第8弾 納期を守る** ✅実装済み | BO-4 展示会WBS(テンプレ+自動生成+アサイン+リマインド) / BO-1 助成金トラッカー | L |
| **第9弾 品質を見える化** ✅実装済み | BO-3 アンケート(取込+3軸分析) / BO-2 事例管理 | M〜L |
| **第10弾 HR** ✅実装済み | BO-5 人材タレント(求人/候補者/面接/台帳/評価) | L |

※ 第8弾を先行するのは「納期遅延=金銭・信用の実害」が最も大きい領域のため。

## 6. 未確定事項（実装前に確認したい）

1. **助成金の種別と正確な期日ルール**: 人材開発支援助成金を想定でよいか？「事前説明会」は顧客向け説明会か、社内キックオフか。計画届など追加マイルストーンの有無
2. **アンケートの現行フォーマット**: 既存の設問・尺度(5段階/10段階)・属性項目のサンプルが欲しい(取込マッピングの初期値を合わせる)
3. **評価制度の項目**: 評価軸(スキル/成果/協働 等)と期間(四半期/半期)の現行運用
4. **経理(finance)ロールの扱い**: BO領域に含めるか、現行のまま独立させるか
5. **講師へのアンケート結果開示**: 講師本人(deliveryロール)に自分のスコアを見せるか
6. **展示会プリセットの初期リスト**: 現在の事前作業チェックリストがあれば、そのまま初期データ化する

---

*本設計は docs/FEATURE_BACKLOG_2026-07.md の後継として、BO領域のバックログを兼ねる。実装時は各弾のコミットで本書のステータスを更新すること。*
