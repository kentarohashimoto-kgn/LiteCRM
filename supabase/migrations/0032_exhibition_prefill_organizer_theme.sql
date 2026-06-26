-- 展示会マスタの主催/テーマを半自動プリフィル(手動入力値は温存=null のみ更新)。
-- 主催: campaigns(展示会)の event_date 年月と exhibition_events.ym を突合(同月一意 or 名称重複時)。
-- テーマ: 展示会名キーワードから推定。
-- ロールバック不要(nullのみ更新の冪等データ補完)。手動修正で上書き可。
update exhibition_events e
set organizer = c.organizer
from campaigns c
join lead_sources ls on ls.id = c.lead_source_id and ls.name = '展示会'
where e.tenant_id = c.tenant_id
  and e.organizer is null and c.organizer is not null and c.event_date is not null
  and to_char(c.event_date, 'YYYYMM') = e.ym
  and (
    norm_company(c.name) ilike '%' || norm_company(coalesce(e.label, '')) || '%'
    or norm_company(coalesce(e.label, '')) ilike '%' || norm_company(c.name) || '%'
    or (select count(*) from campaigns c2 join lead_sources ls2 on ls2.id = c2.lead_source_id and ls2.name = '展示会'
        where c2.tenant_id = e.tenant_id and c2.event_date is not null
          and to_char(c2.event_date, 'YYYYMM') = e.ym and c2.organizer is not null) = 1
  );

update exhibition_events set theme = case
  when label ~* 'バックオフィス|総務|経理|人事' then 'バックオフィス'
  when label ~* '産業DX|DXPO|ODEX|[^A-Za-z]DX|^DX' then 'DX'
  when label ~* 'マーケ|営業|セールス' then '営業・マーケ'
  when label ~* 'スタートアップ|startup' then 'スタートアップ'
  when label ~* 'AI|生成AI' then 'AI'
  else theme end
where theme is null;
