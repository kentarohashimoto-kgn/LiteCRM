-- 0192: 問い合わせフォーム失敗ログ（2026-07-31）
--
-- HPフォーム→/api/lead-intake の失敗理由をサーバー側で記録する。
-- Vercelのログは非技術者が読めず、フォーム側には汎用メッセージしか出せないため、
-- 「なぜ弾かれたか」（トークン不一致 / reCAPTCHAエラーコード / スコア不足 等）を
-- ここに残して原因を確定できるようにする。個人情報は保存しない。
--
-- 書き込みはservice role（APIルート）のみ。画面からの参照は想定しない。

create table if not exists public.lead_intake_failures (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- どの段階で失敗したか: auth / recaptcha / validation / insert
  stage text not null,
  error text,
  -- 診断用の非個人情報（エラーコード・スコア・設定済みシークレット数・origin等）
  detail jsonb
);

comment on table public.lead_intake_failures is 'HPフォーム取込の失敗ログ。原因診断用・個人情報なし・service roleのみ書込';

alter table public.lead_intake_failures enable row level security;
-- ポリシーを作らない = service role以外は読み書き不可
