-- マインドマップ準拠の施策(枠)を追加。attribution不可の枠はコスト/コミット計画用。
-- ロールバック: delete from marketing_channels where lead_source_id is null and name in (...上記...);
with seed(name, category, kind, cm, cq, tl, ord) as (values
  ('自社無料セミナー','セミナー','self',null::text,null::numeric,null::text,11),
  ('共催無料セミナー','セミナー','self',null,null,null,12),
  ('他社有料セミナー','セミナー','self',null,null,null,13),
  ('顧問CTC・稲吉部長','顧問','advisor',null,null,null,21),
  ('顧問CTC・髙橋部長','顧問','advisor',null,null,null,22),
  ('顧問CTC・CTCエスピー','顧問','advisor',null,null,null,23),
  ('顧問CTC・製造業','顧問','advisor',null,null,null,24),
  ('顧問CTC・鳥越専務','顧問','advisor',null,null,null,25),
  ('ビジネスタンク','アポ代行','agency','appointments',5,'smb',31),
  ('ラフメイカー','アポ代行','agency','appointments',2,'smb',32),
  ('Web・SNS広告','広告','ad',null,null,null,41),
  ('雑誌・新聞','広告','ad',null,null,null,42),
  ('SEO・HP','オーガニック','organic',null,null,null,51),
  ('Youtube・SNS','オーガニック','organic',null,null,null,52)
)
insert into marketing_channels(tenant_id, name, category, kind, committed_metric, committed_qty, target_level, sort_order)
select t.tenant_id, s.name, s.category, s.kind, s.cm, s.cq, s.tl, s.ord
from (select distinct tenant_id from marketing_channels) t
cross join seed s
where not exists (select 1 from marketing_channels m where m.tenant_id=t.tenant_id and m.name=s.name);

update marketing_channels set category='アポ代行', kind='agency', committed_metric='appointments', committed_qty=2, target_level='enterprise'
where name='ライトアップ';
