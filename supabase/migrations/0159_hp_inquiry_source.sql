-- D-1b HP問い合わせフォーム流入。
-- HPの問い合わせフォーム(/api/lead-intake)から作成されるリードの流入元
-- 「HP問合せ」を、実テナント(is_demo=false)にあらかじめ用意する。
-- これにより、リード一覧の「流入」フィルタや流入経路別の分析で
-- HP問い合わせ由来のリードを他の流入元(展示会・LP・紹介 等)と切り分けて追える。
--
-- ※ 取込API側でも同名の lead_source を on-the-fly で upsert するため、
--   このマイグレーション未適用でも動作はするが、事前に用意しておくことで
--   最初の1件目から分析・フィルタに正しく現れるようにする。

insert into lead_sources (tenant_id, name, description, status)
select t.id, 'HP問合せ', 'HPの問い合わせフォームからの流入(/api/lead-intake)', 'active'
from tenants t
where t.is_demo = false
  and not exists (
    select 1 from lead_sources ls
    where ls.tenant_id = t.id and ls.name = 'HP問合せ'
  );
