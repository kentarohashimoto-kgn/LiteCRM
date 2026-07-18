-- =====================================================================
-- AI-PMO 夜間バッチのスタート/停止スイッチを登録
--   深夜1時(JST) に /api/cron/pmo-nightly が4モード(振り返りPDCA/未来段取り/
--   案件PJ管理/経営俯瞰)のレポートを自動生成する。停止したい場合は
--   AIバッチ運用画面(/app/exec/batch)からこのジョブをOFFにする。
--   実行ログは batch_runs(job_kind='pmo_nightly') に記録される。
-- =====================================================================

insert into public.batch_job_settings (tenant_id, job_kind, label, description, enabled, note) values
  ('00000000-0000-0000-0000-000000000001', 'pmo_nightly', 'AI-PMO夜間レポート（深夜1時）',
   'ベテランPMアドバイザーの4モード(振り返りPDCA/未来段取り/案件PJ管理/経営俯瞰)を毎晩自動生成。朝イチにAI-PMO画面で最新レポートが読める。', true, null)
on conflict (tenant_id, job_kind) do nothing;
