# Google Chat 連携 設計書（詳細版）

**対象アプリ**: CATORCE Sales OS（Next.js 14 App Router / Supabase / Vercel）
**ステータス**: 設計フェーズ（実装前）
**作成**: 2026-07
**関連ブランチ**: `claude/google-chat-integration-agi8qf`

> 本書は「まず設計だけ」を目的とした詳細設計です。実装は含みません。
> 実装着手前に、末尾「決めておきたいこと」への回答をもって Phase を確定します。

---

## 0. 要件（依頼内容）

| # | 要件 | 種別 |
|---|---|---|
| R1 | **個人チャット（DM）とグループチャット（Space）の両方に送り分けて通知/配信したい** | 送信（Outbound） |
| R2 | **グループのメッセージにスタンプ（絵文字リアクション）を付けたら、それをトリガーに処理を実行したい** | 受信（Inbound / イベント） |
| R3 | **グループ等でメンション付きメッセージを送ったら、CRM 側でアクションできるようにしたい** | 受信（Inbound / 対話） |

### 最重要の前提（アーキテクチャを決める分岐点）

これら3要件は Google Chat の **3つの異なる仕組み** にまたがります。ここを取り違えると作り直しになります。

| 要件 | 使う Google の仕組み | 配信経路 | 備考 |
|---|---|---|---|
| R1 送信 | **Chat REST API** `spaces.messages.create` | アプリ→Google（Outbound） | Incoming Webhook では **DM 送信不可**。Chat App（Bot）が必須 |
| R3 メンション受信 | **Chat App インタラクションイベント**（`MESSAGE`） | Google→アプリHTTP（同期・即応答可） | @メンション or Bot への DM で発火 |
| R2 リアクション受信 | **Google Workspace Events API** + **Cloud Pub/Sub** | Google→Pub/Sub→アプリHTTP（非同期） | リアクションは **インタラクションイベントでは取れない**。Events API 購読が必須 |

> ⚠️ **R2 のリアクションだけは別系統（Pub/Sub 経由）**です。R3 のメンションのような「Bot に届く同期イベント」とは配信経路が異なり、Space ごとの **購読（subscription）作成 + 定期更新** が必要になります。ここが本連携で最も工数のかかる部分です。

したがって、**Incoming Webhook 方式（前回案 A）では R2・R3 が実現できず、フル機能の Chat App（Bot）+ Service Account + Pub/Sub が前提**になります。

---

## 1. 全体アーキテクチャ

```
                         ┌─────────────────────────── Google Workspace ───────────────────────────┐
                         │                                                                          │
   [社員] ──@メンション──▶│  Chat App(Bot)  ──MESSAGE/CARD_CLICKED(HTTP)──┐                          │
   [社員] ──リアクション─▶│  Space / DM      ──reaction.created──▶ Workspace Events API             │
                         │                                              │  └─▶ Cloud Pub/Sub topic  │
                         └──────────────────────────────────────────────┼───────────────┬──────────┘
                                                                         │(push)         │(push)
                                        ┌────────────────────────────────▼───────────────▼──────────┐
                                        │                    CATORCE Sales OS (Vercel)               │
                                        │                                                            │
  Outbound(通知) ◀── Service Account ───┤  /api/chat/events    (R3: メンション/DM/カードクリック)      │
   spaces.messages   (JWT→AccessToken)  │  /api/chat/pubsub    (R2: リアクション等 Events API)         │
                                        │  /api/cron/chat-subscriptions (購読の作成・更新)             │
                                        │  src/lib/chat/*      (送信クライアント/カード生成/検証)       │
                                        │                                                            │
                                        │  Supabase: chat_identities / chat_space_bindings /          │
                                        │            chat_event_log / chat_subscriptions /            │
                                        │            chat_reaction_triggers                           │
                                        └────────────────────────────────────────────────────────────┘
```

### 1.1 Vercel（サーバーレス）という制約

- Vercel は常駐プロセスを持てないため、Pub/Sub は **Pull ではなく Push サブスクリプション（HTTPS 配信）** を使う。
- よって Google からの受信は **すべて HTTPS の Route Handler** に集約できる（運用がシンプル）。
- 送信は Service Account の JWT を都度アクセストークンに交換（サーバー専用）。

---

## 2. Google Cloud / Chat App の構成（Phase 0：管理者作業）

実装前に一度だけ必要な、コンソール側の準備。

| 手順 | 内容 |
|---|---|
| 1 | Google Cloud プロジェクト作成（既存の Gmail OAuth 用プロジェクトと共用可） |
| 2 | **Google Chat API** を有効化 |
| 3 | **Google Workspace Events API** を有効化（R2 リアクション用） |
| 4 | **Cloud Pub/Sub API** を有効化し、トピック `chat-events` を作成 |
| 5 | **Service Account** 作成（アプリ認証用）。JSON キーを発行 |
| 6 | Chat API → **Configuration** で Chat App を構成：<br>・アプリ名 / アバター / 説明<br>・**Interactive features: ON**<br>・接続方式 = **HTTP endpoint URL** → `https://<APP>/api/chat/events`<br>・（任意）スラッシュコマンド定義（`/deal` `/task` `/log` 等）<br>・公開範囲 = 組織内（Internal） |
| 7 | Pub/Sub トピックに **Push サブスクリプション** を作成 → エンドポイント `https://<APP>/api/chat/pubsub`、**OIDC 認証トークン付き** |
| 8 | Workspace Events 用のスコープ **`chat.app.messages.readonly`**（アプリ認証でメッセージ/リアクションイベントを購読）を Service Account に許可 |

> 既存の `.env.example` にある Gmail OAuth（`GOOGLE_CLIENT_ID/SECRET`）とは **別物**。あちらはユーザー個人の Gmail 送受信用の OAuth、こちらは Bot（Service Account）としての Chat 用。

---

## 3. 受信/送信で必要になる認証・スコープ整理

| 用途 | 認証主体 | 方式 | スコープ/権限 |
|---|---|---|---|
| R1 送信（Bot として投稿） | Service Account | JWT→AccessToken（アプリ認証） | `https://www.googleapis.com/auth/chat.bot`（App 構成に紐づく） |
| R2 リアクション購読 | Service Account（アプリ認証） | Workspace Events API | `chat.app.messages.readonly` |
| R2/R3 受信の正当性検証（HTTP） | Google | Bearer JWT 検証 | 発行者 `chat@system.gserviceaccount.com` / audience=プロジェクト番号 |
| R2 受信の正当性検証（Pub/Sub push） | Google | OIDC トークン検証 | audience=push エンドポイント |

- **アプリ認証（app auth）** ではカード/ウィジェット付きメッセージを送れる（DM も可）。
- **ユーザー認証（user auth）** はテキストのみ。今回は Bot 主体なので **原則アプリ認証** を採用。

---

## 4. データモデル（Supabase 追加テーブル）

既存の `notifications` テーブル（アプリ内通知）はそのまま活かし、Chat 連携用に以下を追加。すべて **マルチテナント前提**（`tenant_id` 付与、RLS 適用）。

### 4.1 `chat_identities` — CRM ユーザー ⇄ Google Chat ユーザーの対応表
DM 送り分け（R1）とメンション実行者の本人特定（R3）の基盤。

```sql
create table chat_identities (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  member_id     uuid not null references members(id),   -- CRM 側ユーザー
  chat_user_id  text not null,                          -- Google Chat "users/123456789"
  dm_space_name text,                                   -- 解決済み DM Space "spaces/AAAA"（キャッシュ）
  email         text,                                   -- 突合キー（GWS メール）
  created_at    timestamptz default now(),
  unique (tenant_id, member_id),
  unique (tenant_id, chat_user_id)
);
```

### 4.2 `chat_space_bindings` — Google Chat Space ⇄ CRM エンティティの紐付け
「この営業グループの Space は、この案件/取引先/チームに対応」を持つ。R2/R3 でイベントを正しいレコードへルーティングするために必須。

```sql
create table chat_space_bindings (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  space_name   text not null,                 -- "spaces/AAAA"
  space_type   text not null,                 -- 'dm' | 'group'
  entity_type  text,                          -- 'deal' | 'account' | 'team' | null(汎用)
  entity_id    uuid,                          -- 紐付く CRM レコード
  is_active    boolean default true,
  created_at   timestamptz default now(),
  unique (tenant_id, space_name)
);
```

### 4.3 `chat_reaction_triggers` — リアクション→アクションの定義（R2）
どの絵文字を、どの文脈のメッセージに付けたら、何を実行するか。

```sql
create table chat_reaction_triggers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  emoji        text not null,          -- "✅" / ":white_check_mark:" / カスタム絵文字名
  scope        text not null,          -- 'any' | 'space' | 'message_kind'
  space_name   text,                   -- scope='space' の場合
  message_kind text,                   -- 'danger_deal' | 'digest' 等（Bot 送信時に付与するタグ）
  action       text not null,          -- 'mark_reviewed' | 'snooze' | 'assign_me' | 'create_task' | 'escalate'
  action_args  jsonb default '{}',
  is_active    boolean default true
);
```

### 4.4 `chat_subscriptions` — Workspace Events 購読の管理（R2）
購読は **有効期限があり、切れる前に更新が必要**。更新 cron が参照する。

```sql
create table chat_subscriptions (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  space_name        text not null,
  subscription_name text not null,      -- Events API "subscriptions/XXXX"
  event_types       text[] not null,    -- ['google.workspace.chat.reaction.v1.created', ...]
  expire_time       timestamptz not null,
  state             text default 'active',
  updated_at        timestamptz default now(),
  unique (tenant_id, space_name)
);
```

### 4.5 `chat_event_log` — 冪等性/監査（R2/R3）
Pub/Sub は **at-least-once（重複配信あり）**。イベント ID で重複実行を防ぐ。

```sql
create table chat_event_log (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid,
  event_id     text not null,          -- Chat/Events の一意 ID
  event_type   text not null,
  space_name   text,
  payload      jsonb,
  processed_at timestamptz default now(),
  unique (event_id)                    -- 冪等キー
);
```

---

## 5. R1: 個人/グループ 送り分け（送信）

### 5.1 送信クライアント `src/lib/chat/client.ts`
- Service Account JSON から JWT を生成 → `https://oauth2.googleapis.com/token` でアクセストークン取得（短命・メモリキャッシュ）。
- `POST https://chat.googleapis.com/v1/{parent=spaces/*}/messages` を叩く薄いラッパ。

### 5.2 送信ターゲットの抽象化
通知呼び出し側は「誰/どこに」だけ指定し、Space 解決はライブラリが担う。

```ts
type ChatTarget =
  | { type: "dm";     memberId: string }      // 個人チャット
  | { type: "space";  spaceName: string }     // 特定グループ
  | { type: "entity"; entityType: "deal"|"account"|"team"; entityId: string }; // 紐付く Space へ

sendChatMessage(target: ChatTarget, payload: TextOrCard, opts?: { messageKind?: string })
```

**解決ロジック**
| target | 解決手順 |
|---|---|
| `dm` | `chat_identities.dm_space_name` を参照。無ければ `spaces.findDirectMessage`（無ければ `spaces.setup` で DM 作成）→ 結果を `dm_space_name` にキャッシュ |
| `space` | そのまま `spaces/{id}` に投稿 |
| `entity` | `chat_space_bindings` から `space_name` を引く（複数可） |

- `messageKind`（例 `danger_deal` / `digest`）を **カードのメタ or メッセージ末尾のタグ**として埋め込み、R2 のリアクショントリガー判定に使う。
- アプリ認証なので **カード（見出し・案件リンク・ボタン）** で送る。テキストのみのフォールバックも用意。

### 5.3 既存資産との接続（差分は小さい）
現状 `src/app/api/cron/daily-digest/route.ts` は `SLACK_WEBHOOK_URL` に POST しているだけ。ここに以下を追加/置換する：

- 毎朝ダイジェスト → **担当者個人へ DM**（`{type:'dm', memberId}`）＋ 営業チーム Space へサマリ（`{type:'space'}`）。
- 危険案件検知（`automation.ts` / `notifications` insert 箇所）→ 担当へ DM、重要案件はマネージャー Space へ。
- リード取込通知（`lead-intake`）→ 反響対応チーム Space へ。

> `notifications` テーブルへの insert（アプリ内通知）は現状どおり残し、**Chat 送信を「もう一つの配信チャネル」として並行**させる（Slack と同じ思想）。

### 5.4 制約（R1）
- DM は **同一 Google Workspace 組織内ユーザー**が対象。組織外へは送れない。
- Bot がまだ会話に存在しないユーザーへ DM する場合、アプリ認証で DM Space を作成できるが、組織の Chat App 公開設定に依存。
- グループ送信は **Bot がそのメンバーである Space** のみ（招待が前提）。

---

## 6. R3: メンション → CRM アクション（対話・同期）

### 6.1 受信エンドポイント `POST /api/chat/events`
Chat App のインタラクションイベントを受ける（HTTP endpoint 方式）。

**受信フロー**
1. **署名検証**: リクエストの Bearer JWT（発行者 `chat@system.gserviceaccount.com`、audience=プロジェクト番号）を検証。失敗は 401。
2. **イベント種別で分岐**:
   - `ADDED_TO_SPACE` / `REMOVED_FROM_SPACE` → `chat_space_bindings` を作成/無効化（＋案内カード返信）。
   - `MESSAGE` → 本文からメンションを除去しコマンド解釈（下記）。
   - `CARD_CLICKED` → カードのボタン押下（確認ダイアログの Yes 等）を実行。
3. **本人特定 & 権限**: `event.user`（`users/{id}`）→ `chat_identities` で CRM member 解決。未登録ユーザーは実行拒否（登録導線カードを返す）。CRM 権限（RLS 相当）はその member として評価。
4. **同期応答**: 200 応答の body に返信カードを載せて即時返信（結果 + CRM 詳細リンク）。

### 6.2 コマンド設計（メンション本文の解釈）
「@CRM 〜」の後続をパース。**スラッシュコマンド**（Chat App 定義）と**自然文**の両対応を想定。

| 入力例 | アクション | 実行内容 |
|---|---|---|
| `@CRM 商談 #1234` | 参照 | 商談カード（金額/ステージ/確度/次アクション）を返信 |
| `@CRM 商談 #1234 ステージ=提案` | 更新 | ステージ変更（監査ログ記録） |
| `@CRM タスク 見積書送付 期限=明日 #1234` | 起票 | タスク作成し担当へ紐付け |
| `@CRM 議事録 <本文>` | 活動記録 | 商談に activity として記録（将来 AI 要約と連携） |
| `@CRM 今日` | ダイジェスト | 自分の今日のアポ/次AC/危険案件を返信 |

- Space が案件に bind されていれば `#1234` 省略時は **その案件を暗黙対象**にできる（`chat_space_bindings`）。
- 破壊的操作（ステージ変更・受注/失注）は **確認カード（`CARD_CLICKED`）でワンクッション**。

### 6.3 制約（R3）
- グループ Space では **@メンションされた時のみ** Bot にイベントが届く（全メッセージは来ない）。DM では全メッセージが届く。
- 応答は原則同期（数秒以内）。重い処理は「受付カード」を返し、非同期で追って更新する。

---

## 7. R2: リアクション → 処理実行（Events API + Pub/Sub）

**本連携の中核かつ最工数。** リアクションは §6 のインタラクションイベントには含まれず、Workspace Events API での購読が必須。

### 7.1 購読の作成/更新 `POST /api/cron/chat-subscriptions`
- 対象 Space（`chat_space_bindings` で active なグループ）ごとに、Events API で購読を作成：
  - `event_types = ['google.workspace.chat.reaction.v1.created', 'google.workspace.chat.reaction.v1.deleted']`（必要なら `message.v1.created` も）
  - 通知先 = Pub/Sub トピック `chat-events`
  - スコープ `chat.app.messages.readonly`
- 購読は **期限切れ前に更新**が必要 → Vercel Cron（`vercel.json`）で定期実行。`chat_subscriptions.expire_time` を見て更新。

### 7.2 受信エンドポイント `POST /api/chat/pubsub`
1. **OIDC 検証**: Push サブスクリプションの OIDC トークン（audience=このURL）を検証。失敗は 401。
2. **冪等性**: `message.messageId`/イベント ID を `chat_event_log` に upsert。既存なら 200 で即終了（重複配信対策）。
3. **ペイロード解釈**: `google.workspace.chat.reaction.v1.created` から
   - リアクションした `user`、対象 `message`、`emoji` を取得（必要に応じ `spaces.messages.get` で対象本文/`messageKind` タグを取得）。
4. **トリガー判定**: `chat_reaction_triggers` を `emoji` × `scope(space/message_kind)` で照合。
5. **アクション実行**（例）:

| 絵文字 | 対象メッセージ | アクション |
|---|---|---|
| ✅ | 危険案件アラート | 「確認済み」→ アラートをスヌーズ/クローズ、activity 記録 |
| 👀 | 未担当リード通知 | リアクションした人を担当にアサイン |
| 🔥 | 任意 | 案件を「要エスカレ」フラグ＋マネージャー Space へ通知 |
| 📝 | ダイジェスト行 | その案件のタスク起票 |

6. 実行者は §6.1 と同様に `chat_identities` で CRM member に解決し、権限評価。
7. 結果を必要に応じ Space にスレッド返信（「✅ を受け付け、案件#1234 を確認済みにしました」）。

### 7.3 制約（R2）— 重要
- リアクションイベントは **Space 単位で購読が必要**。Bot を入れただけでは来ない（購読作成が要る）。
- 購読は **有効期限つき → 更新 cron 必須**。更新漏れ＝イベント欠落。
- Pub/Sub は **at-least-once**（重複あり）→ 冪等性必須（§7.2-2）。
- カスタム絵文字/標準絵文字で識別子表現が異なる点をトリガー定義で吸収。

---

## 8. 追加する API ルート / ファイル一覧

| パス | 役割 | 要件 |
|---|---|---|
| `src/lib/chat/client.ts` | Service Account 認証・送信ラッパ | R1 |
| `src/lib/chat/cards.ts` | カード（案件/タスク/確認ダイアログ）生成 | R1/R3 |
| `src/lib/chat/verify.ts` | Bearer JWT / OIDC 検証 | R2/R3 |
| `src/lib/chat/targets.ts` | ChatTarget→Space 解決（DM/space/entity） | R1 |
| `src/lib/chat/commands.ts` | メンション本文パース→アクション | R3 |
| `src/lib/chat/reactions.ts` | リアクション→トリガー照合・実行 | R2 |
| `src/app/api/chat/events/route.ts` | インタラクション受信（メンション/DM/カード） | R3 |
| `src/app/api/chat/pubsub/route.ts` | Events API 受信（リアクション等） | R2 |
| `src/app/api/cron/chat-subscriptions/route.ts` | 購読の作成/更新 | R2 |
| `src/components/settings/chat-integration.tsx` | 設定 UI（識別子登録/Space 紐付け/トリガー編集） | 共通 |
| Supabase migration | §4 の5テーブル + RLS | 共通 |

---

## 9. 環境変数（追加）

`.env.example` に追記予定。

```bash
# ── Google Chat 連携（Bot / Service Account）────────────────────────
# Chat App のアプリ認証に使う Service Account 資格情報（JSON を1行化 or Base64）。
# 秘密。Vercel では "Sensitive" で登録。未設定なら Chat 連携は全機能スキップ。
GOOGLE_CHAT_SA_CREDENTIALS=

# 受信検証用: Google Cloud プロジェクト番号（Bearer JWT の audience 照合）。
GOOGLE_CHAT_PROJECT_NUMBER=

# R2 リアクション用: Pub/Sub トピック（購読作成時に使用）。
GOOGLE_CHAT_PUBSUB_TOPIC=projects/<project-id>/topics/chat-events

# Pub/Sub Push の OIDC 検証で期待する audience（= /api/chat/pubsub の絶対URL）。
GOOGLE_CHAT_PUBSUB_AUDIENCE=https://<APP>/api/chat/pubsub

# 既存の CRON_SECRET を購読更新 cron（/api/cron/chat-subscriptions）にも流用。
```

`vercel.json` の cron に購読更新ジョブを追加（例: 数時間ごと）。

---

## 10. セキュリティ / 運用

- **受信は必ず検証**: Chat=Bearer JWT、Pub/Sub=OIDC。未検証リクエストは 401。
- **冪等性**: `chat_event_log` の unique(event_id) で重複実行防止。
- **最小権限**: 送信=`chat.bot`、購読=`chat.app.messages.readonly` のみ。ユーザーの Gmail 等他スコープは要求しない。
- **本人確認**: `chat_identities` 未登録ユーザーからの操作は実行しない（登録導線を返す）。
- **権限評価**: メンション/リアクション実行者を CRM member として解決し、既存 RLS ポリシーに沿って操作（他人の案件を勝手に更新させない）。
- **監査**: 破壊的操作は activity/監査ログに「Chat 経由・実行者・元メッセージ」を残す。
- **フェイルセーフ**: `GOOGLE_CHAT_SA_CREDENTIALS` 未設定時は Slack/メールと同様に **完全 no-op**（既存機能に影響なし）。
- **マルチテナント**: Space/識別子/トリガーは `tenant_id` で分離。将来の外販でもテナント跨ぎ漏洩なし。

---

## 11. 段階的ロールアウト（実装フェーズ）

| Phase | 内容 | 満たす要件 | 依存 |
|---|---|---|---|
| **P0** | GCP/Chat App/Service Account/Pub/Sub 準備（管理者作業） | 前提 | — |
| **P1** | 送信基盤（`lib/chat/*` 送信・カード・ターゲット解決）＋ 既存ダイジェスト/危険案件を DM+Space に配信 | **R1** | P0 |
| **P2** | `/api/chat/events`：メンション→参照/更新/起票 コマンド ＋ 設定UI（識別子登録・Space紐付け） | **R3** | P0,P1 |
| **P3** | Events API 購読 cron ＋ `/api/chat/pubsub`：リアクション→トリガー実行 | **R2** | P0,P2 |

> R1→R3→R2 の順が安全。R2 は購読基盤・冪等性・cron を伴い最も重いため最後。

---

## 12. 決めておきたいこと（実装着手の前提）

1. **Google Workspace 管理権限**：Chat App 構成・API 有効化・Service Account 発行ができる管理者はいますか？（P0 は管理者作業）
2. **DM 配信の対象**：毎朝ダイジェスト等は「担当者個人 DM」中心でよいですか？それともチーム Space 中心？
3. **紐付ける Space**：どの Google Chat グループを、CRM の何（案件/取引先/営業チーム）に対応させますか？（初期 binding の設計）
4. **リアクションの割当**：どの絵文字にどの処理を割り当てますか？（§7.2 の例をベースに確定したい）
5. **メンションで許可する操作範囲**：参照のみ／起票まで／ステージ更新など破壊的操作まで、どこまで許可しますか？
6. **識別子マッピングの作り方**：`chat_identities`（CRM⇄Chatユーザー）はメール突合で自動生成しますか？手動登録 UI を用意しますか？

---

## 付録: 参考（Google 公式ドキュメント）

- Subscribe to Google Chat events（Workspace Events API）: https://developers.google.com/workspace/events/guides/events-chat
- Google Chat event types（`reaction.v1.created` 等）: https://developers.google.com/workspace/chat/events-overview
- Send a message（`spaces.messages.create`）: https://developers.google.com/workspace/chat/create-messages
- Find a direct message space（DM 解決）: https://developers.google.com/workspace/chat/find-direct-message-in-spaces
- Create a Workspace subscription: https://developers.google.com/workspace/events/guides/create-subscription
- Choose Events API scopes: https://developers.google.com/workspace/events/guides/auth
- Build a Chat app with Pub/Sub: https://developers.google.com/workspace/chat/quickstart/pub-sub
