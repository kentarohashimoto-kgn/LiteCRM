# HP問い合わせフォーム → CRM連携 指示書

**対象**: HP(コーポレートサイト/LP)の制作・保守を担当する開発者
**目的**: HPの問い合わせフォームに入力があったら、CATORCE Sales OS(CRM)に「流入元 = HP問合せ」で1件のリードを自動登録し、社内・問い合わせ元双方へメール通知する。
**版**: 2026-07 / **CRM側実装**: `POST /api/lead-intake`

---

## 0. これだけ読めば実装できる要約

- **叩き先**: `POST https://<CRM_BASE_URL>/api/lead-intake`
  （現行既定: `https://lite-crm-tau.vercel.app/api/lead-intake`）
- **認証**: HTTPヘッダー `x-intake-token: <発行されたシークレット>`
- **本文**: JSON もしくは `application/x-www-form-urlencoded`。
  最低限 `company`（会社名）または `email` のどちらかが必須。
- **流入元**: 送らなければ自動で **「HP問合せ」**。フォームを分けたい場合のみ `source` を指定。
- **成功**: `200 {"ok":true,"id":"<lead-uuid>"}`
- **強く推奨**: トークンをブラウザに晒さないため、**HP側サーバー(PHP/Node等)を1枚挟んで**中継する。静的HTMLから直POSTも可能だが、その場合トークンが露出する点に注意（後述 §6）。

---

## 1. 全体フロー

```
[HPの問い合わせフォーム]
        │ ①送信(POST + トークン)
        ▼
[HP側サーバー(推奨) or 直接] ──②──► [CRM  POST /api/lead-intake]
                                          │ ③ leads に1件INSERT（流入元=HP問合せ）
                                          ├─► アプリ内通知（owner/admin/sales_manager）
                                          ├─► Slack通知（設定時）
                                          ├─► ④-a 問い合わせ元へ自動返信メール
                                          └─► ④-b 社内関係者へ通知メール
                                          ▼
                                 [CRM リード画面でトリアージ]
                                  営業スパム等を「対象外」に落とし、
                                  有効な問い合わせを「案件化」する
```

---

## 2. CRM側の技術スタック（参考情報）

| 領域 | 技術 |
|---|---|
| フレームワーク | Next.js 14（App Router / Route Handler）/ TypeScript |
| ホスティング | Vercel |
| DB | Supabase（PostgreSQL）。書き込みは service role でRLSをバイパスするサーバー処理 |
| メール送信 | nodemailer（SMTP）。`SYSTEM_SMTP_*` で設定した共有no-reply箱から送信 |
| 認可 | 共有シークレット（`x-intake-token`）+ CORSオリジン制限 + ハニーポット |

HP側の技術は問いません（WordPress / 静的HTML / Next / PHP など何でも可）。**HTTPSでPOSTできれば連携できます。**

---

## 3. エンドポイント仕様

| 項目 | 内容 |
|---|---|
| URL | `https://<CRM_BASE_URL>/api/lead-intake` |
| メソッド | `POST`（プリフライト用に `OPTIONS` も応答） |
| 認証ヘッダー | `x-intake-token: <LEAD_INTAKE_SECRET>`（本文の `token` フィールドでも可） |
| Content-Type | `application/json` または `application/x-www-form-urlencoded` |
| CORS | 既定は全許可だが、本番はHPのオリジンのみ許可に設定（CRM側 `LEAD_INTAKE_ALLOW_ORIGIN`） |

### 3.1 リクエストフィールド

| フィールド | 必須 | 最大長 | 説明 |
|---|---|---|---|
| `company` | △ | 200 | 会社名。`company` か `email` のどちらか一方は必須 |
| `email` | △ | 200 | 問い合わせ者メール。**自動返信メールの宛先**にもなる |
| `name` | 任意 | 100 | 氏名・担当者名 |
| `phone` | 任意 | 50 | 電話番号 |
| `message` | 任意 | 2000 | 問い合わせ内容(自由記述) |
| `media` | 推奨 | 100 | **流入元メディア**＝どのサイト/媒体からか（例: `カトルセHP`, `キャリプラ`, `Aicafe`）。CRMの「HP問合せ」一覧でメディア別に区別・絞り込み・集計できる。**各サイトのフォームに固定値で埋め込む**とよい。 |
| `source` | 任意 | 100 | **流入詳細**＝種別/資料名（例: `資料請求：単価相場表2026`, `無料相談`, `法人研修相談`）。**未指定なら「HP問合せ」**。CRMでは流入詳細として表示・絞り込み。 |
| `tags` | 任意 | — | **集計用タグ**（カンマ区切り。例: `資料請求,生成AI`）。何が何件ダウンロードされたか等の集計に使う。最大20個、各40文字。 |
| `website` | — | — | **ハニーポット**。画面上は隠し、人間は空のまま送る欄。値が入っていたらbotとみなし破棄（§6.3） |
| `token` | — | — | ヘッダーを使えない場合の代替トークン置き場（ヘッダー推奨） |

> **メディアと詳細の使い分け**: `media` は「どのサイト/媒体か」（カトルセHP / キャリプラ / Aicafe …）、`source` は「何の資料か/相談種別か」（資料名・無料相談 …）。この2つを分けて送ると、CRMの「HP問合せ」一覧で **受付日時・流入元(メディア)・流入詳細・タグ** を列で確認でき、メディア別・資料別の集計ができます。

> `event` は旧名の後方互換として `source` と同義に受け付けます。新規実装では `source` を使ってください。

### 3.2 レスポンス

| HTTP | ボディ | 意味 |
|---|---|---|
| `200` | `{"ok":true,"id":"<uuid>"}` | 登録成功（ハニーポット破棄時も `{"ok":true}` を返す＝botに気づかせない） |
| `400` | `{"ok":false,"error":"..."}` | 本文が不正 / `company`と`email`が両方空 |
| `401` | `{"ok":false,"error":"unauthorized"}` | トークン不一致 |
| `503` | `{"ok":false,"error":"intake not configured"}` | CRM側でトークン未設定 |

フォーム側は **`ok:true` を成功、それ以外を失敗** として扱ってください。

---

## 4. 呼び出し例

### 4.1 【推奨】HP側サーバーを経由する（トークンを秘匿）

ブラウザからは自社サーバーへ送り、サーバーからCRMへ中継します。トークンはサーバー環境変数に置きHPのソースに出しません。

**サーバー中継(Node/Next の例)**
```js
// HP側のサーバー(例: /api/contact)。トークンは環境変数から。
export async function POST(req) {
  const form = await req.json(); // { company, name, email, phone, message }
  const res = await fetch("https://<CRM_BASE_URL>/api/lead-intake", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-intake-token": process.env.LEAD_INTAKE_SECRET, // ★サーバーのみ
    },
    body: JSON.stringify({ ...form, media: "カトルセHP", source: "HP問合せ", tags: "問い合わせ" }),
  });
  const data = await res.json();
  return Response.json({ ok: data.ok });
}
```

**PHP(WordPress等)の例**
```php
<?php
$payload = json_encode([
  "company" => $_POST["company"] ?? "",
  "name"    => $_POST["name"] ?? "",
  "email"   => $_POST["email"] ?? "",
  "phone"   => $_POST["phone"] ?? "",
  "message" => $_POST["message"] ?? "",
  "source"  => "HP問合せ",
]);
$ch = curl_init("https://<CRM_BASE_URL>/api/lead-intake");
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    "Content-Type: application/json",
    "x-intake-token: " . getenv("LEAD_INTAKE_SECRET"), // ★サーバーのみ
  ],
  CURLOPT_POSTFIELDS => $payload,
]);
$body = curl_exec($ch);
```

### 4.2 静的HTMLから直接送る（サーバーを持てない場合）

```html
<form id="contact">
  <input name="company" placeholder="会社名" required>
  <input name="name" placeholder="お名前">
  <input name="email" type="email" placeholder="メール">
  <input name="phone" placeholder="電話番号">
  <textarea name="message" placeholder="お問い合わせ内容"></textarea>
  <!-- ハニーポット: 目に見えないようにして人間には触らせない -->
  <input name="website" tabindex="-1" autocomplete="off"
         style="position:absolute;left:-9999px" aria-hidden="true">
  <button type="submit">送信</button>
</form>

<script>
document.getElementById("contact").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  fd.append("media", "カトルセHP");   // ← このサイトのメディア名(固定値)
  fd.append("source", "資料請求：〇〇"); // ← 何の資料/相談か
  fd.append("tags", "資料請求");        // ← 集計用タグ(任意, カンマ区切り)
  const res = await fetch("https://<CRM_BASE_URL>/api/lead-intake", {
    method: "POST",
    headers: { "x-intake-token": "<公開されても被害を限定できるトークン>" },
    body: fd, // form-encoded として送信される
  });
  const data = await res.json();
  alert(data.ok ? "送信しました。ありがとうございました。" : "送信に失敗しました。");
});
</script>
```

### 4.3 疎通確認(curl)

```bash
curl -i -X POST "https://<CRM_BASE_URL>/api/lead-intake" \
  -H "Content-Type: application/json" \
  -H "x-intake-token: <LEAD_INTAKE_SECRET>" \
  -d '{"company":"テスト商事","name":"山田太郎","email":"test@example.com","message":"料金を知りたい","source":"HP問合せ"}'
# 期待: HTTP/1.1 200 ... {"ok":true,"id":"..."}
```

---

## 5. 通知・メール仕様（CRM側で自動実行）

1件登録されると、CRM側が以下を自動で行います（HP側の追加実装は不要）。

- **アプリ内通知**: owner / admin / sales_manager に「新しいリード(HP問合せ)」を表示。
- **Slack通知**: `SLACK_WEBHOOK_URL` 設定時のみ、指定チャンネルに投稿。
- **④-a 問い合わせ元への自動返信メール**: フォームに有効な `email` があれば、受付確認メールを送信（件名「【会社名】お問い合わせを受け付けました」）。返信先を有人アドレスにしたい場合は `INQUIRY_REPLY_TO` を設定。
- **④-b 社内関係者への通知メール**: 宛先は `INQUIRY_NOTIFY_EMAILS`（カンマ区切り）優先。未設定なら owner/admin/sales_manager のログインメールに自動送信。件名「【HP問合せ】新規問い合わせ: 会社名」、本文にCRMリード詳細への導線付き。

> メールは `SYSTEM_SMTP_*`（共有no-reply箱）が設定されている場合のみ送信されます。未設定でもリード登録・アプリ内通知は動作します（メールだけ静かにスキップ）。

---

## 6. セキュリティと運用上の注意

### 6.1 トークンの扱い
- `x-intake-token` は**共有シークレット**です。可能な限り **§4.1のサーバー中継**でブラウザに出さないでください。
- 万一漏れた場合はCRM側で `LEAD_INTAKE_SECRET` を再発行すれば無効化できます（HP側の設定値も差し替え）。

### 6.2 CORSオリジン制限
- 本番では、CRM側環境変数 `LEAD_INTAKE_ALLOW_ORIGIN` にHPの正規オリジン（例 `https://www.catorce.jp`）を設定し、他サイトからのブラウザ直POSTを弾きます。**HPの本番オリジンをCRM管理者に共有してください。**

### 6.3 スパム対策
- **ハニーポット**: `website` という隠し欄を必ずフォームに置いてください。人間は空のまま、botは埋めがち。値があるとCRMは登録せず成功を装って破棄します。
- **reCAPTCHA(推奨・対応済み)**: HP側で Google reCAPTCHA を入れ、取得したトークンを送信時に **`g-recaptcha-response`**（または `recaptcha` / `recaptchaToken`）フィールドで一緒にPOSTしてください。CRM側は `RECAPTCHA_SECRET`（シークレットキー）を設定するとサーバーでこのトークンを検証し、**人間性を確認できない送信を拒否**します（v3のスコアは既定0.5で足切り、v2チェックボックスも可）。
  - **重要**: `RECAPTCHA_SECRET` を設定すると、**この エンドポイントに投げる全フォーム**が reCAPTCHA トークンを送る必要があります（未送信は 400 で拒否）。reCAPTCHA を入れていないフォームがある場合は、先に全フォームへ導入してから `RECAPTCHA_SECRET` を設定してください。
  - サイトキー（公開）はHP側、シークレットキーはCRM側の環境変数（非公開）に置きます。
- CRMのリード画面で、営業スパム等は後述のトリアージで**「対象外」**に落とせます。

### 6.4 バリデーション
- CRM側でも各項目を最大長で切り詰め、`company`/`email` の必須チェックを行いますが、HP側でも入力チェック（メール形式・必須）を行うとユーザー体験が良くなります。

---

## 7. CRM側の運用（不要な営業問い合わせの排除 → 有効リードの選別）

登録されたHP問合せは、CRMの **リード画面（`/app/leads`）** で仕分けます。HP側の実装は不要です。運用の流れ:

1. **一覧で絞り込み**: 「流入」フィルタで **「HP問合せ」** を選ぶと、HP由来の問い合わせだけを表示。
2. **不要な営業問い合わせを排除**: ファネルの **「対象外」** に落とす（または決着を「対象外」に）。集計・架電キューから外れます。
3. **有効な問い合わせを選別**: 見込みのあるものは相談候補(MQL)→商談候補(SQL)→アポ獲得へ前進、または **「案件化」** ボタンで商談化。
4. 分析タブで流入元「HP問合せ」別のアポ率・件数を確認できます。

---

## 8. 連携前チェックリスト

**CRM管理者側（本CRMの環境変数 / Vercel）**
- [ ] `LEAD_INTAKE_SECRET` を発行し、HP開発者に安全に共有
- [ ] `LEAD_INTAKE_ALLOW_ORIGIN` にHP本番オリジンを設定
- [ ] メール通知を使う場合: `SYSTEM_SMTP_HOST/PORT/USER/PASS`、`SYSTEM_MAIL_FROM(_NAME)` を設定
- [ ] 社内通知先を固定したい場合: `INQUIRY_NOTIFY_EMAILS` を設定
- [ ] 自動返信の返信先を有人にしたい場合: `INQUIRY_REPLY_TO` を設定
- [ ] マイグレーション `0159_hp_inquiry_source.sql` を適用（流入元「HP問合せ」を用意。未適用でもAPIが自動作成するが事前推奨）

**HP開発者側**
- [ ] 問い合わせフォームに `company / name / email / phone / message` と隠し `website`（ハニーポット）を用意
- [ ] 送信先を `POST https://<CRM_BASE_URL>/api/lead-intake` に設定
- [ ] `x-intake-token` ヘッダーを付与（推奨: サーバー中継でトークン秘匿）
- [ ] `source` を送るなら「HP問合せ」（未指定でも既定でHP問合せ）
- [ ] `ok:true` を成功として扱うフロント処理
- [ ] curl(§4.3)で疎通確認 → CRMのリード一覧に登録されることを確認

---

### 付録: CRM側の関連実装

| ファイル | 役割 |
|---|---|
| `src/app/api/lead-intake/route.ts` | 公開エンドポイント本体（認可・登録・通知・メール） |
| `src/lib/mail-system.ts` | システムSMTP送信（自動返信・社内通知の送信手段） |
| `src/lib/inquiry-emails.ts` | 自動返信 / 社内通知メールの本文組み立て |
| `supabase/migrations/0159_hp_inquiry_source.sql` | 流入元「HP問合せ」を実テナントに用意 |
