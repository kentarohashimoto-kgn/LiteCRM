/** ルート遷移中に即時表示するスケルトン(体感速度の向上)。 */
export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-6">
        <div className="h-7 w-48 rounded-lg bg-black/[0.06]" />
        <div className="mt-2 h-4 w-80 max-w-full rounded bg-black/[0.04]" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card card-pad">
            <div className="h-3 w-20 rounded bg-black/[0.05]" />
            <div className="mt-3 h-7 w-24 rounded bg-black/[0.07]" />
          </div>
        ))}
      </div>
      <div className="card overflow-hidden">
        <div className="border-b border-black/[0.05] px-5 py-3">
          <div className="h-4 w-40 rounded bg-black/[0.05]" />
        </div>
        <div className="divide-y divide-black/[0.04]">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3">
              <div className="h-4 flex-1 rounded bg-black/[0.04]" />
              <div className="h-4 w-24 rounded bg-black/[0.04]" />
              <div className="h-4 w-16 rounded bg-black/[0.04]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
