# 一斉メール配信インフラ設計 — 1万通/回・UTAGEリプレース（2026-08）

> **目的**: 現行の「送信者本人のGmail/SMTPから300通/日」という営業メールの枠組みとは**別レーン**として、
> **1回1万通規模の一斉配信（メルマガ）を自前インフラで実現**し、既存のUTAGE（月額21,670円・配信無制限）のメール配信をリプレースする。
> **前提資料**: `docs/CRM_BULK_MAIL_REDESIGN_2026-08.md`（対象抽出・UI・カテゴリの再検討。本書はそのインフラ編）
> **作成日**: 2026-08-02 / 対象ブランチ: `claude/crm-bulk-email-feature-m853m2`
> **本書はコード変更を含まない設計・意思決定文書**。

---

## 0. 先に結論

1. **二車線モデルにする**。営業の個別・少量メール（返信してもらう文脈のメール）は現行どおり**本人のGmail/SMTP**（300通/日ガード維持）。メルマガ等の一斉配信は**配信専用の送信API＋配信専用サブドメイン**の新レーンで送る。1万通/回を本人Gmailで送るのは技術的にも（Gmail自体の送信上限）レピュテーション的にも不可能であり、レーン分離が業界標準。
2. **送信APIの第一候補は Resend（Pro $20/月・5万通）**。Vercel+Supabaseの現行スタックと相性がよく、バッチ送信API・Webhook（バウンス/苦情）が最短で組める。**月間総量が5万通を大きく超える見込みなら Amazon SES**（$0.10/1,000通＝1万通約$1・従量制）へ。送信は既に `deliverTrackedEmail` 1箇所に集約されているため、**ドライバ差し替え可能な設計にして後から乗り換えられるようにする**（乗り換えコスト小）。
3. **開封/クリック計測・配信停止・サプレッション・テンプレは既存実装をそのまま流用**する。自前トラッキング（`/api/track/o|c|u`）はプロバイダ非依存で、ワンクリック配信停止（List-Unsubscribe-Post）も実装済み。Gmailの大量送信者要件（2024年施行・**2025年11月から強制排除を強化**）のソフト面はすでに満たしており、**残る必須作業はDNS（SPF/DKIM/DMARC）と、バウンス/苦情Webhookの自動サプレッションのみ**。
4. **いきなり1万通は送れない**。新しい配信ドメインは2〜4週間のウォームアップ（1,000→2,500→5,000→10,000通と漸増）が必要。この期間は**UTAGEと並行運用**し、ウォームアップ完了をもって切替える移行計画とする（§6）。
5. コストは **UTAGE 21,670円/月 → Resend 約3,000円/月（または SES 数百円/月）**。ランニングは約1/7〜1/40になる。ただしUTAGEのメール以外の機能（LINE配信・LP/ファネル・会員サイト・決済）は本件のスコープ外＝**リプレースされない**ので、解約可否はUTAGEの利用実態の棚卸しが前提（§7 論点1）。

---

## 1. 要件

| 項目 | 要件 |
|---|---|
| 配信規模 | 1回あたり最大10,000通（将来余地あり） |
| 配信種別 | メルマガ・セミナー案内・キャンペーン（広告宣伝メール＝特電法対応必須） |
| 対象 | CRMの顧客（contacts）＋リード（leads）。対象抽出は前ドキュメントD1/D2 |
| 計測 | 開封・クリック・配信停止・バウンドを配信（ブラスト）単位と企業/個人単位で集計 |
| 差出人 | 会社名義（例: `news@`配信サブドメイン）。返信は営業個人 or 共有受信箱へ |
| 既存資産 | テンプレ・差し込み・トラッキング・サプレッション・反応分析を流用 |
| リプレース対象 | UTAGEの「メルマガ／一斉配信」機能（ステップ配信は既存 `email_sequences` で代替検討） |

---

## 2. 前提: 2026年の大量送信ルール（Gmail/Yahoo送信者ガイドライン）

1日5,000通以上をGmail宛に送る送信者は以下が必須。**2025年11月以降、非準拠トラフィックは一時拒否→恒久拒否の段階的排除が始まっている**ため、準拠は選択ではなく前提条件。

| 要件 | 現状 | 対応 |
|---|---|---|
| SPF / DKIM / DMARC（アライメント一致） | ❌ 配信ドメイン未整備 | **W-1**: 配信専用サブドメインのDNS設定（§4.1） |
| ワンクリック配信停止（List-Unsubscribe / List-Unsubscribe-Post） | ✅ 実装済み（`mail-smtp.ts` / `/api/track/u`） | 流用 |
| 本文内の明示的な配信停止リンク | ✅ 実装済み（フッター＋特電法の広告判定 `detectAdSignals`） | 流用 |
| 迷惑メール率 0.3%未満（実用目標 0.1%） | ❌ 計測手段なし | **W-4**: 苦情Webhook＋Google Postmaster Tools 登録 |
| バウンス処理 | ◑ `mail_suppressions` は手動系 | **W-4**: Webhookで自動追加 |
| TLS送信 | ✅ 送信API側で担保 | — |

---

## 3. 送信経路の比較と選定

| | **Resend（推奨MVP）** | **Amazon SES（スケール時）** | SendGrid | 国産（blastengine等） |
|---|---|---|---|---|
| 料金（月4万通想定） | Pro **$20/月**（5万通まで） | **約$4**（$0.10/1,000通・完全従量） | Essentials $19.95（5万通） | 数千円〜 |
| 1万通/回の可否 | ○（バッチAPI 100通/呼び出し） | ○（送信レート引上げ申請） | ○ | ○ |
| バウンス/苦情Webhook | ○（シンプル） | ○（SNS経由・構築要） | ○ | ○ |
| 実装・運用負担 | **最小**（APIキーのみ。Vercel/Next親和） | 中（AWSアカウント・サンドボックス解除・SNS配線が新規負担） | 中 | 中（日本語サポート有） |
| スケール上限コスト | 10万通/月超で割高化 | **ほぼ線形・最安** | 専用IPはPro $89.95〜 | プラン次第 |

**選定方針**: 現在のチームはAWS未運用（Vercel+Supabase構成）。月間総量が「1万通×週1＝4〜5万通/月」程度に収まるならResendが実装最速・運用ゼロで、UTAGE比でも大幅減。**月10万通超が見えたらSESへ移行**——そのために送信処理は `deliverTrackedEmail` 配下に**ドライバインターフェース**（`smtp` / `google_oauth` / `resend` / `ses`）を切って抽象化する（W-2）。

---

## 4. アーキテクチャ

```
[対象抽出 D1/D2]                 [配信実行]                        [反応・衛生]
contacts/leads 絞り込み      /api/cron/blast (毎分)             既存 /api/track/o|c|u
  → mail_blasts(1配信)   →   mail_blast_recipients から         (開封/クリック/配信停止)
  → mail_blast_recipients     未送分を取得 → レート制御しつつ
    (宛先スナップショット)      送信APIへバッチ投入               プロバイダWebhook
    queued/sent/bounced…       → 状態更新・email_messages記録  →  /api/hooks/mail-events
                                                                  (bounce/complaint →
                                                                   mail_suppressions 自動追加)
```

### 4.1 配信専用サブドメイン（W-1）

- 例: `news.catorce.jp`（名称は要決定）。**会社ドメイン本体のレピュテーションを配信事故から隔離**するための分離。
- SPF・DKIM（プロバイダ発行の公開鍵）・DMARC（`p=none` で開始→観測後 `quarantine` へ）をDNSに設定。FromはこのサブドメインでDMARCアライメントを取る。
- 返信は `Reply-To` で営業個人 or 共有受信箱（既存の受信同期の対象にできる）。
- Google Postmaster Tools にドメイン登録し、迷惑メール率・レピュテーションを常時監視。

### 4.2 配信キューとデータモデル（W-3）

一斉配信は「宛先ごとの送達状態」を持つ必要があるため、リード一括メールの `lead_mail_batches`（集計のみ）とは別に専用テーブルを新設。RLS4点セット・`set_updated_at`・`batch_job_settings(job_kind='blast')` 停止スイッチは既存原則を踏襲。

```
mail_blasts（1回の一斉配信）
  id, tenant_id, title, template_id, subject_tmpl, body_tmpl,   -- 送信時点のスナップショット
  segment_json,                 -- 対象抽出条件(再現用)
  channel text,                 -- 'resend'|'ses'|... (ドライバ)
  from_addr, reply_to,
  status('draft'|'scheduled'|'sending'|'paused'|'done'|'canceled'),
  scheduled_at, started_at, finished_at,
  total, sent, failed, bounced, complained, opened, clicked, unsubscribed,  -- 集計キャッシュ
  rate_per_minute int,          -- ウォームアップ期の絞り(既定は全速)
  created_by, created_at, updated_at

mail_blast_recipients（宛先スナップショット・冪等キー）
  id, tenant_id, blast_id,
  email, contact_id(null可), lead_id(null可), account_id(null可),
  vars jsonb,                   -- 差し込み値(抽出時に確定)
  status('queued'|'sent'|'failed'|'bounced'|'suppressed_skip'),
  provider_message_id,          -- Webhook突合キー
  sent_at, error_text, created_at
  unique(blast_id, email)       -- 二重投入防止
```

- **冪等性**: cronが何度走っても `status='queued'` のみ処理。`unique(blast_id, email)` で宛先重複を構造的に防止。
- **一時停止**: `mail_blasts.status='paused'` で即停止（苦情率が跳ねた時の非常ブレーキ）。
- 送信成功時は既存 `email_messages` にも記録し、開封/クリックは既存 `email_events` に紐づく（企業別・個人別の反応分析＝前ドキュメントD4がそのまま効く）。

### 4.3 送信cron（W-2）

- `/api/cron/blast`（毎分・`CRON_SECRET`認可・`getSupabaseAdmin()`）。`sending` 状態のblastから `rate_per_minute` 分の宛先を取り、**バッチAPI**（Resend: 100通/呼び出し）で投入。1万通は全速なら10〜20分で完了。Vercel関数の実行時間内に収まるよう1回のcronで送る量を制限（チャンク方式は既存の予約送信cronと同型）。
- 送信直前に `mail_suppressions` を最終突合（抽出後に配信停止した人を落とす）。

### 4.4 バウンス/苦情Webhook（W-4）

- `/api/hooks/mail-events`（署名検証つき）。hard bounce / complaint を受けて `mail_suppressions` に自動追加＋ `mail_blast_recipients` の状態更新。
- 苦情率（complained/sent）を `mail_blasts` に集計し、**0.1%超で管理者へSlack通知、0.3%到達で自動 pause** をルール化（既存 `automation_rules` の出力口を流用）。

### 4.5 ウォームアップ（運用設計）

新規サブドメインからいきなり1万通を送ると、認証が完璧でも迷惑メール判定される。**2〜4週間のランプアップをUTAGE並行運用期間として計画に織り込む**:

| 週 | 1回あたりの配信量 | 備考 |
|---|---|---|
| 1週目 | 〜1,000通 | 反応の良いアクティブ層（開封実績のある宛先）から送る |
| 2週目 | 〜2,500通 | Postmaster Toolsでレピュテーション確認 |
| 3週目 | 〜5,000通 | 苦情率0.1%未満を維持できていること |
| 4週目〜 | 10,000通 | UTAGE切替完了 |

`mail_blasts.rate_per_minute`＋配信量ガードで機械的に制御する（人が覚えておかなくてよい設計）。

---

## 5. 既存実装との整合

| 既存 | 本件での扱い |
|---|---|
| 本人Gmail/SMTP送信（300通/日） | **現行のまま**（営業の個別・少量レーン）。日次上限も維持 |
| `deliverTrackedEmail` | ドライバ抽象化して blast レーンでも共通利用（開封ピクセル・リンクラップ・フッター注入を共通化） |
| `/api/track/o|c|u`・`email_events` | そのまま流用（プロバイダ非依存の自前計測を維持。乗り換え耐性の要） |
| `mail_suppressions` | 共通のサプレッションとして両レーンで突合＋Webhookで自動追加 |
| `email_templates`・差し込み | そのまま流用 |
| `scheduled_emails`・sequences | 現行レーンのまま。ステップ配信の大量化が必要になったら blast レーンへ拡張 |
| `lead_mail_batches`・反応分析 | 少量レーンの履歴として現行のまま。blastは `mail_blasts` で同型のUIを用意 |

---

## 6. UTAGEからの移行計画

1. **棚卸し**: UTAGEで実際に使っている機能を確認（メルマガ/ステップ/LP/LINE/会員/決済）。**本件がリプレースするのはメール配信のみ**。
2. **リスト移行**: UTAGEから購読者リストをCSVエクスポート → contacts/leadsへ取込（既存 `dedupe.ts` の名寄せを流用）。**配信停止リストの移行が最重要**（漏れると停止済みの人に再送→苦情→レピュテーション毀損）。`mail_suppressions` へ一括投入。
3. **DNS整備**（W-1）→ テスト配信（社内＋シードアドレスでGmail/Outlook/Yahooの受信箱到達を確認）。
4. **並行運用＋ウォームアップ**（§4.5）: 新レーンの配信量を漸増、UTAGE側を漸減。
5. **切替**: 苦情率<0.1%・到達安定を確認して UTAGE のメール配信を停止。メール以外の機能が残る場合は契約継続の要否を判断。

---

## 7. 意思決定が必要な論点

1. **UTAGEの利用範囲**: メール配信以外（LINE・LP/ファネル・会員サイト・決済）を使っているか。使っている場合、解約はできないためコスト削減幅が変わる（リプレース範囲の確定）。
2. **月間総配信量の見込み**: 1万通×何回/月か。〜5万通/月ならResend（$20）、それを大きく超える計画ならSESを初手から選ぶ。
3. **配信サブドメイン名**: `news.catorce.jp` / `mail.catorce.jp` 等。DNSを触れる管理者の確保。
4. **差出人と返信先の運用**: 会社名義From＋Reply-Toをどこに向けるか（共有受信箱 or 担当者個人）。
5. **切替時期**: ウォームアップ2〜4週間＋実装期間から逆算してUTAGE解約（または縮小）月を決める。
6. **AWS運用の許容**（SESを選ぶ場合のみ）: AWSアカウントの管理者・請求の扱い。

---

## 8. ワークオーダー分解

前ドキュメント（対象抽出D1〜D5）と合わせて実装する。W系が本書スコープ。

| WO | 内容 | 依存 | 規模 |
|---|---|---|---|
| **W-1** | 配信サブドメインのDNS（SPF/DKIM/DMARC）＋プロバイダ契約＋Postmaster Tools登録 | 論点2・3の決定 | 小（作業は主にDNS） |
| **W-2** | 送信ドライバ抽象化＋Resend(またはSES)ドライバ＋`/api/cron/blast` | W-1 | 中 |
| **W-3** | `mail_blasts` / `mail_blast_recipients` マイグレーション＋配信作成UI（対象抽出D1/D2と接続）＋配信詳細/一時停止UI | D1, D2 | 中 |
| **W-4** | バウンス/苦情Webhook→自動サプレッション＋苦情率の自動pause・Slack通知 | W-2 | 小〜中 |
| **W-5** | UTAGEリスト・配信停止リストの取込ツール | — | 小 |
| **W-6** | ウォームアップ制御（配信量ガード・`rate_per_minute`）＋blast反応分析ビュー | W-3 | 小〜中 |

**最短経路**: 論点2・3を決定 → W-1（DNSは伝播待ちがあるため最優先）→ W-2/W-3を並行 → W-5でリスト移行 → ウォームアップ開始。実装着手からUTAGE切替完了まで**目安6〜8週間**（うち2〜4週はウォームアップの待ち時間）。

---

## 9. コスト比較（メール配信部分のみ・月4万通想定）

| | UTAGE（現行） | Resend Pro | Amazon SES |
|---|---|---|---|
| 月額 | 21,670円（配信無制限・全機能込み） | 約3,000円（$20） | 約600円（$4）＋AWS管理 |
| 初期 | — | 実装WO（W-1〜W-6） | 同左＋AWSセットアップ |
| 備考 | メール以外の機能も含む点に注意 | 5万通/月まで | 完全従量・スケール最安 |
