-- ============================================================
-- タスクのカラー付与＋既定並び順を優先度ベースに正規化
--   - tasks.color: カード色（NULL=既定/優先度色）。COLOR_KEYS のキーを想定。
--   - sort_order を「優先度が高いものが上」になるよう再採番（セクション単位）。
--     以降のドラッグ並び替えは sort_order を上書きして自由に前後できる。
-- ============================================================

alter table public.tasks add column if not exists color text;

-- 優先度ランク(high=0/middle・null=1/low=2)を10万刻みの帯にして、
-- 帯内は従来の並び順→作成順で採番。セクション未設定はプロジェクト単位でまとめる。
with ranked as (
  select
    id,
    (case priority when 'high' then 0 when 'low' then 2 else 1 end) * 100000
      + row_number() over (
          partition by coalesce(section_id::text, project_id::text, 'none')
          order by
            (case priority when 'high' then 0 when 'low' then 2 else 1 end),
            sort_order,
            created_at
        ) as new_order
  from public.tasks
)
update public.tasks t
set sort_order = r.new_order
from ranked r
where r.id = t.id;
