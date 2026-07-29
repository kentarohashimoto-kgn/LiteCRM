-- 0180 予約送信に List-Unsubscribe ヘッダの独立フラグを追加
--
-- 配信停止導線は2つあり役割が違う:
--   unsubscribe_footer : 本文末尾の可視フッター。特定電子メール法の表示義務を満たすのはこちら
--                        (広告宣伝を含む内容で必須)
--   unsubscribe_header : List-Unsubscribe ヘッダ(不可視)。Gmail等の配信停止ボタン用で、
--                        迷惑メール報告の代わりに押してもらい苦情率＝ドメイン評価を守る
--
-- 純粋なお礼・業務連絡を一括送信する場合に「本文はそのまま・ヘッダのみ」を選べるようにする。
-- null は「フッターに追従」(既存行・個別送信の従来挙動を維持)。

alter table public.scheduled_emails
  add column if not exists unsubscribe_header boolean;

comment on column public.scheduled_emails.unsubscribe_header is
  'List-Unsubscribeヘッダを付けるか。null=unsubscribe_footerに追従。一括送信はフッター無しでもtrue';
