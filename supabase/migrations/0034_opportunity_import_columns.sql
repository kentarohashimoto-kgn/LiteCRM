-- 商談CSV移行用の列: 外部キー/取込ソース + 商談ログの事前情報
-- ロールバック: alter table opportunities drop column external_ref, drop column import_source;
--               alter table meetings drop column pre_info;
alter table opportunities add column if not exists external_ref text;
alter table opportunities add column if not exists import_source text;
alter table meetings add column if not exists pre_info text;
create index if not exists idx_opps_import_source on opportunities(import_source);
