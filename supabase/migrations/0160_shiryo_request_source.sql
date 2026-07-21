-- D-1b 資料ダウンロードフォーム流入。
-- HPの資料ダウンロードフォーム(/api/lead-intake, source=資料請求)由来のリードの
-- 流入元「資料請求」を、実テナント(is_demo=false)にあらかじめ用意する。
-- ※ 取込API側でも同名の lead_source を on-the-fly で upsert するため未適用でも動作するが、
--   最初の1件目から分析・フィルタに正しく現れるよう先出しする。

insert into lead_sources (tenant_id, name, description, status)
select t.id, '資料請求', 'HPの資料ダウンロードフォームからの流入(/api/lead-intake)', 'active'
from tenants t
where t.is_demo = false
  and not exists (
    select 1 from lead_sources ls
    where ls.tenant_id = t.id and ls.name = '資料請求'
  );
