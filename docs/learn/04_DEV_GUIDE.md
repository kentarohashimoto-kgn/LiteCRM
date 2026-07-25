# CATORCE Learn 開発ドキュメント v1.0

作成: 2026-07-25 ｜ 対象読者: 実装担当（実装スレッドのClaude Code含む）

## 1. リポジトリ・プロジェクト構成

- **新規リポジトリ `catorce-learn` を作成**（LiteCRMとは分離。理由: 外販時の切り出し・デプロイ独立性）
- Supabaseも専用プロジェクトを新設（LiteCRM本番と分離。命名: `catorce-learn-prod` / `catorce-learn-dev`）

```
catorce-learn/
├── src/
│   ├── app/
│   │   ├── (learner)/          # 学習者ポータル
│   │   ├── (tenant-admin)/     # 顧客管理画面
│   │   ├── (catorce-admin)/    # 運営管理画面
│   │   └── api/                # A-01〜A-10 (詳細設計§3)
│   ├── lib/                    # supabaseクライアント, cf-stream, can-view, 権限ガード
│   └── components/
├── supabase/
│   ├── migrations/             # DDL+RLS (詳細設計§2)
│   └── tests/                  # RLSテスト (TC-SEC群)
├── e2e/                        # Playwright (TC-UI/UAT)
└── docs/                       # 本ドキュメント一式をコピーして正とする
```

- LiteCRMの実装から流用してよいもの: マルチテナントRLSパターン、Supabaseクライアント初期化、Slack通知、Vercel Cron構成、UIコンポーネントの流儀（Tailwind）

## 2. 環境変数

| 変数 | 用途 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | クライアント |
| `SUPABASE_SERVICE_ROLE_KEY` | サーバ側（Webhook/cron/管理APIのみ。クライアント厳禁） |
| `CF_ACCOUNT_ID` / `CF_STREAM_API_TOKEN` | Stream API（アップロードURL発行） |
| `CF_STREAM_SIGNING_KEY_ID` / `CF_STREAM_SIGNING_KEY_PEM` | 署名付き再生トークン |
| `CF_WEBHOOK_SECRET` | Webhook署名検証 |
| `TRANSCRIBE_API_KEY` | 文字起こし（Whisper系） |
| `ANTHROPIC_API_KEY` | P2レポート講評（モデルは `claude-sonnet-5` を既定） |
| `SLACK_WEBHOOK_URL` | cron失敗・重要イベント通知 |
| `CRON_SECRET` | Vercel Cronの認証 |

## 3. 開発フロー・規約

- ブランチ: `main`（本番）/ feature branches → PR。Vercel Preview必須確認
- マイグレーション: `supabase/migrations` に追記のみ（編集禁止）。ローカル→dev→prodの順で適用。**RLSポリシーのないテーブルをmainにマージ禁止**（CIで検査）
- 型: `supabase gen types typescript` をCIで生成しコミット
- テスト: PRごとにVitest＋RLSテスト、mainマージ前にPlaywright E2E。リリース判定はテスト仕様書§1に従う
- コーディング規約はLiteCRMに準拠（命名・ディレクトリ・コメント方針）。秘密情報・顧客名をコードコメントに書かない
- 動画UID以外にCloudflare側の情報をDBへ複製しない（正はStream側）

## 4. 実装マイルストーン（15〜20人日 / 2026-11着手 → 2027-01ローンチ）

| 週 | 完了物 | 対応 |
|---|---|---|
| W1 | Supabaseプロジェクト・スキーマ・RLS一式＋RLSテスト（TC-SEC）先行実装 | 詳細設計§2 |
| W2 | 認証・招待フロー（A-01/02）＋テナント/ID上限制御 | FR-01/02/03/12 |
| W3 | Stream連携（A-03/04/05）＋再生画面＋can_view | FR-05/06 |
| W4 | 視聴ログ（A-06/A-10）＋学習者ポータル | FR-07/08 |
| W5 | 顧客管理・運営管理画面＋特典＋期限cron（A-09） | FR-09/10/11 |
| W6 | 文字起こしパイプライン＋CSVレポート＋E2E/UAT＋コンテンツ搭載 | NFR-09/FR-09・受入基準 |

- **W1でRLSテストを先に書く**（セキュリティをテスト駆動にする。後追い実装を禁止）
- コンテンツ搭載（アーカイブ10本＋Light 8本）は開発と並行して平石さん側で進行

## 5. 運用設計

| 項目 | 内容 |
|---|---|
| cron | `expire`(日次00:10 JST)・`aggregate`(毎時)・失敗はSlack通知（LiteCRMの朝ダイジェストに相乗り可） |
| 監視 | Vercel/Supabaseメトリクス＋Sentry（LiteCRMと同一組織） |
| バックアップ | Supabase日次＋PITR。リストア訓練 年1回（OPS-04） |
| 契約変更 | 運営画面でplan/id_limit/契約期間を変更（即時反映）。金額はLiteCRM billing_schedulesが正 |
| 特典発行 | 営業からの依頼はLiteCRMの商談IDをsourceに記録（「どの商談の特典か」を追跡可能に） |
| 解約 | status=terminated→視聴不可。データは6ヶ月保持後に削除（規約に明記） |
| コンテンツ更新 | 月4本の搭載チェックリスト（動画・標準学習時間・タグ・文字起こし確認）を月次タスク化 |

## 6. スコープガード（実装スレッドへの申し送り）

1. **商品仕様・価格はHANDOFF §2が正。実装の都合で変えない**（変更は経営スレッドへ差し戻し）
2. MVPに決済・SCORM・モバイルアプリを入れない。P3のRAG実装も始めない（transcripts蓄積だけはMVPで必須）
3. 「助成金対応」4要件（記名ID・視聴ログ・標準学習時間・修了管理）に関わる実装は、社労士確認の結果次第で仕様変更があり得る前提で疎結合に
4. UTAGE解約は「全アーカイブ移行完了」まで実施しない（並行期間のコスト月2.5万は許容済み）
5. 開発順は上記マイルストーン通り。W3（再生）まで完了した時点でパイロット企業へのデモが可能になる——1月のLightローンチから逆算して**12月中旬デモが中間ゲート**

## 7. 着手時チェックリスト（実装スレッド初日）

- [ ] `docs/CATORCE_LEARN_HANDOFF.md` と本ディレクトリ4文書を読む
- [ ] `catorce-learn` リポジトリ作成・本docs一式をコピー
- [ ] Supabase dev プロジェクト作成・W1マイグレーション着手
- [ ] Cloudflare Streamアカウント・署名キー発行（環境変数§2）
- [ ] 社労士確認（定額制訓練の要件）の状況を経営スレッドに確認
