-- 0192: リード一覧のエンゲージメント絞り込み・並べ替え用ビュー
-- person_engagement はメールアドレス単位の集計で leads と FK を持たないため、
-- 一覧クエリがSQL側でエンゲージ(ランク・合計点)により絞り込み/並べ替え/ページング
-- できるよう LEFT JOIN したビューを用意する(従来はページング後にJSで突合していた)。
-- security_invoker により基表(leads / person_engagement)のRLSが呼び出しユーザー権限で適用される。
create or replace view lead_list_eng
with (security_invoker = true) as
select
  l.*,
  pe.rank          as eng_rank,
  pe.score         as eng_score,
  pe.touch_count   as eng_touch_count,
  pe.last_touch_at as eng_last_touch_at
from leads l
left join person_engagement pe
  on pe.tenant_id = l.tenant_id
 and pe.email = lower(l.email);

comment on view lead_list_eng is 'リード一覧+エンゲージメント(person_engagement をメール小文字で突合)。eng_rank が null のリードは接点なし(=Dランク相当)。';

grant select on lead_list_eng to authenticated, service_role;
