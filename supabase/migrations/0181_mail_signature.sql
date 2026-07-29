-- 0181 送信者ごとの署名(メール末尾の会社名・役職・連絡先ブロック)
--
-- 同じテンプレでも差出人ごとに変わる部分(氏名・役職・メールアドレス・SNS)を
-- {signature} 差し込みで吸収する。メール設定画面から本人が編集できる。
-- 未設定(null/空)なら {signature} は空文字に展開される。

alter table public.user_mail_accounts
  add column if not exists signature text;

comment on column public.user_mail_accounts.signature is
  'メール末尾の署名ブロック。テンプレの {signature} に差し込まれる。null/空なら差し込みは空文字';

-- 稼働中アカウントの初期署名を投入(本人が設定画面でいつでも変更可)。
-- 役職・SNSは個人ごとに異なるため、確定している分のみ入れる。
update public.user_mail_accounts a
set signature = concat_ws(e'\n',
      '----------------------------------------------------------------',
      '株式会社カトルセ',
      '代表取締役　橋本　健太郎',
      '〒104-0061　東京都中央区銀座1-22-11-2F',
      'TEL 03-6775-9051',
      'HP　https://catorce.jp/',
      'MAIL　kentaro.hashimoto@catorce.jp',
      'facebook　https://www.facebook.com/kentarono14',
      '----------------------------------------------------------------')
from auth.users u
where u.id = a.user_id
  and u.email = 'kentaro.hashimoto@catorce.jp'
  and coalesce(a.signature, '') = '';

update public.user_mail_accounts a
set signature = concat_ws(e'\n',
      '----------------------------------------------------------------',
      '株式会社カトルセ',
      coalesce(nullif(p.display_name, ''), '（氏名を入力してください）'),
      '〒104-0061　東京都中央区銀座1-22-11-2F',
      'TEL 03-6775-9051',
      'HP　https://catorce.jp/',
      concat('MAIL　', u.email),
      '----------------------------------------------------------------')
from auth.users u
left join public.profiles p on p.id = u.id
where u.id = a.user_id
  and u.email <> 'kentaro.hashimoto@catorce.jp'
  and coalesce(a.signature, '') = '';
