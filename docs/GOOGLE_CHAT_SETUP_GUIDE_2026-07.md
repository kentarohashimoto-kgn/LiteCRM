# Google Chat 連携 セットアップ手順書（管理者向け）

**対象**: Google Workspace 管理者
**関連**: 設計書 `docs/GOOGLE_CHAT_INTEGRATION_DESIGN_2026-07.md`
**この手順で有効になる範囲**: **P1 = 送信（CRM → Google Chat への通知/ダイジェスト配信、DM・グループ両対応）**

> 実装（アプリ側）は「未設定なら完全 no-op」で先行済みです。**この手順書の作業が完了して初めて、実際に Chat へメッセージが飛びます**。作業前でもアプリは正常に動きます（Chat だけ黙ってスキップ）。
>
> まずは **STEP 6 の「グループSpaceへの送信」だけ** で疎通確認するのが最短です（ユーザーIDの取得が不要）。DM（STEP 7）は後追いで大丈夫です。

---

## 所要時間の目安

- STEP 1〜5（Google Cloud 側）: 約 20〜30 分
- STEP 6（グループ疎通）: 約 10 分
- STEP 7（DM 有効化）: ユーザー1人あたり 2〜3 分

---

## STEP 1. Google Cloud プロジェクトを用意

1. https://console.cloud.google.com/ を開く（**Workspace 管理者アカウント**で）。
2. 既存の「Gmail OAuth 用プロジェクト」があればそれを流用可。無ければ上部のプロジェクト選択 →「新しいプロジェクト」→ 名前 `catorce-chat`（任意）→ 作成。
3. 作成したプロジェクトを**選択した状態**にする（以降すべて同じプロジェクトで作業）。
4. 画面右上あたりに出る **プロジェクト番号**（数字）を控える（P2/P3 で使用。P1 では不要）。

## STEP 2. 必要な API を有効化

「APIとサービス」→「ライブラリ」で以下を検索して **有効にする**：

- **Google Chat API** ← P1 で必須
- （P3 で使う分。今は任意）Google Workspace Events API / Cloud Pub/Sub API

## STEP 3. サービスアカウントを作成し、鍵を発行

1. 「IAMと管理」→「サービスアカウント」→「**サービスアカウントを作成**」。
2. 名前 `catorce-chat-bot`（任意）→「作成して続行」→ ロール付与はスキップで可 →「完了」。
3. 作成したサービスアカウントを開く →「**キー**」タブ →「鍵を追加」→「新しい鍵を作成」→ **JSON** → 作成。
4. **JSON ファイルがダウンロードされる**（`catorce-chat-xxxx.json`）。これは秘密情報。安全に保管。

## STEP 4. Chat App（Bot）を構成

1. 「APIとサービス」→ **Google Chat API** →「**構成 (Configuration)**」タブを開く。
2. 以下を入力：
   - **アプリ名**: `CATORCE CRM`（Chat 上での表示名）
   - **アバターURL**: 任意の画像URL（無ければ適当なアイコンURL）
   - **説明**: `営業CRMからの通知と操作`
   - **機能**: 「**1対1メッセージを受信**」「**スペースに参加してグループ会話を受信**」を **ON**
     （P1 の送信だけなら受信設定は必須ではありませんが、後続 P2/P3 のため ON 推奨）
   - **接続設定**: いったん「**App URL**」を選び、URL に `https://<あなたのアプリのURL>/api/chat/events` を仮入力
     （P1 送信のみなら未使用。P2 実装時に本使用）
   - **公開範囲 (Visibility)**: 「**特定のユーザーとグループ**」または組織内全体。まずは自分＋テスト対象者を指定。
3. 保存。

## STEP 5. Vercel に認証情報を登録

STEP 3 でダウンロードした JSON を環境変数に設定します。**2通り**のうち簡単な方で。

### 方法A（推奨・Base64）
ローカルのターミナルで：
```bash
base64 -i catorce-chat-xxxx.json | tr -d '\n' ; echo
```
出力された長い文字列をコピー。

### 方法B（生JSON）
JSON ファイルの中身を**そのまま**（改行含む）コピー。

そして Vercel：
1. プロジェクト → **Settings** → **Environment Variables**。
2. 追加：
   - **Key**: `GOOGLE_CHAT_SA_CREDENTIALS`
   - **Value**: 方法A の文字列 or 方法B のJSON
   - **Environment**: Production（必要なら Preview も）
   - **Sensitive**: ✅ ON
3. 保存 →「**Redeploy**」で反映（環境変数は再デプロイで有効化）。

> ローカル検証する場合は `.env.local` に同じ `GOOGLE_CHAT_SA_CREDENTIALS=...` を記載。

---

## STEP 6. グループSpaceへの送信を疎通確認（最短ルート）

**ここまでで送信は動きます。** ユーザーIDが要らないグループ送信でまず確認します。

### 6-1. テスト用グループSpaceを作り、Botを追加
1. Google Chat で新しい **スペース**を作成（例: `営業チーム`）。
2. スペース内で `@CATORCE CRM`（STEP4のアプリ名）とメンション → 「スペースに追加」で Bot を招待。
   - もしくはスペースのメンバー管理 →「**アプリを追加**」→ `CATORCE CRM`。

### 6-2. Space ID を取得
- ブラウザ版 Google Chat でそのスペースを開き、URL を見る：
  `https://mail.google.com/chat/u/0/#chat/space/**AAAAxxxxxxx**`
- この `AAAAxxxxxxx` が Space ID。**`spaces/AAAAxxxxxxx`** の形で使います。

### 6-3. CRM と紐付け（Supabase SQL）
Supabase ダッシュボード →「SQL Editor」で、あなたのテナントに対して実行：

```sql
-- 自分の tenant_id を確認（is_demo=false の実テナント）
select id, name from tenants where is_demo = false;

-- 営業チームSpaceを team として紐付け（entity_id は tenant.id と同じ値にする規約）
insert into chat_space_bindings (tenant_id, space_name, space_type, entity_type, entity_id, label, is_active)
values (
  '<上で確認した tenant_id>',
  'spaces/AAAAxxxxxxx',       -- 6-2 の Space ID
  'group',
  'team',
  '<同じ tenant_id>',
  '営業チーム',
  true
);
```

### 6-4. 送信テスト
毎朝ダイジェストの cron を手動で叩く（`CRON_SECRET` は Vercel の環境変数の値）：
```bash
curl -H "Authorization: Bearer <CRON_SECRET>" https://<あなたのアプリURL>/api/cron/daily-digest
```
- レスポンス JSON に `"chatTeam": 1` が出て、Google Chat の営業チームSpaceにダイジェストカードが届けば **成功**。
- `"chatTeam": 0` の場合は下の「うまくいかない時」を参照。

---

## STEP 7. 個人DM を有効化（ユーザーごと）

DM 送信には「CRMユーザー ⇄ Google Chat ユーザーID」の対応が必要です。

### 7-1. 対象ユーザーの Chat ユーザーID を取得
いずれかの方法で数字のIDを取得します：
- **方法A（Admin Console）**: https://admin.google.com → ディレクトリ → ユーザー → 対象者を開く。ブラウザの URL 末尾に出る数字（例 `.../users/**1234567890123456789**`）がユーザーID。
- **方法B（後日ラク）**: P2（メンション受信）実装後は、対象者が Bot を @メンションすると自動でIDが取れる仕組みにできます。

### 7-2. CRMユーザーと突き合わせて登録（Supabase SQL）
```sql
-- 対象CRMユーザーの user_id をメールで確認
select id, email, display_name from profiles where email = 'tanaka@example.com';

-- Chat ユーザーIDを対応付け（chat_user_id は "users/<数字>" 形式）
insert into chat_identities (tenant_id, user_id, chat_user_id, email)
values (
  '<tenant_id>',
  '<上で確認した profiles.id>',
  'users/1234567890123456789',   -- 7-1 の数字
  'tanaka@example.com'
)
on conflict (tenant_id, user_id)
do update set chat_user_id = excluded.chat_user_id, email = excluded.email;
```

これで、その担当者宛のダイジェストが**個人DM**でも届くようになります（`dm_space_name` はアプリが初回送信時に自動解決・キャッシュします）。

---

## うまくいかない時（チェックリスト）

| 症状 | 確認ポイント |
|---|---|
| `chatTeam: 0` / `chatDm: 0` のまま | `GOOGLE_CHAT_SA_CREDENTIALS` が Vercel に設定され **Redeploy 済み**か |
| 401/403 がログに出る | STEP4 の Chat App 構成が保存済みか。サービスアカウントが同一プロジェクトか |
| グループに届かない | Bot がそのスペースに**追加**されているか（6-1） |
| DM が届かない | `chat_identities.chat_user_id` が `users/<数字>` 形式で登録されているか。対象者が組織内ユーザーか |
| `curl` が 401 | `CRON_SECRET` の値が正しいか（Vercel の環境変数と一致） |

ログは Vercel の **Functions ログ**（`/api/cron/daily-digest`）で確認できます。

---

## 次フェーズで追加でお願いする作業（参考・今は不要）

- **P2（メンション→CRM操作）**: STEP4 の App URL を本使用 → Chat App の「Slash command」定義、公開範囲の確定。
- **P3（リアクション→処理）**: Pub/Sub トピック `chat-events` 作成 + Push サブスクリプション（→ `/api/chat/pubsub`）+ サービスアカウントに `chat.app.messages.readonly` スコープ許可。

各フェーズ着手時に、この手順書へ追記します。
