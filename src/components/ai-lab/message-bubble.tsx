"use client";

import { AlertCircle, Download } from "lucide-react";
import { labErrorMessage } from "@/lib/ai-lab/limits";
import { modelLabel } from "@/lib/ai-lab/models";
import type { LabUiMessage } from "@/lib/ai-lab/ui-types";
import { Markdown } from "./markdown";

export function MessageBubble({ message, streaming }: { message: LabUiMessage; streaming?: boolean }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-teal-primary px-4 py-2.5 text-sm text-white whitespace-pre-wrap leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }

  // 停止(aborted)は失敗ではないので、警告ではなく淡い注記にする。
  const aborted = message.errorCode === "aborted";
  const failed = Boolean(message.errorCode) && !aborted;

  return (
    <div className="flex justify-start">
      <div className="max-w-[95%] min-w-0">
        {failed ? (
          <div className="flex items-start gap-2 rounded-2xl rounded-bl-sm bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{labErrorMessage(message.errorCode)}</span>
          </div>
        ) : (
          <div className="rounded-2xl rounded-bl-sm bg-white border border-black/[0.06] px-4 py-3 shadow-card">
            {message.content && <Markdown text={message.content} />}
            {streaming && !message.content && (
              <span className="inline-flex gap-1 py-1" aria-label="生成中">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink/30" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink/30 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink/30 [animation-delay:300ms]" />
              </span>
            )}
            {message.images.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-3">
                {message.images.map((src, i) => (
                  <figure key={i} className="w-full max-w-sm">
                    {/* 署名URL(外部ホスト)のため next/image は使わず素の img で表示する */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="生成された画像" className="w-full rounded-xl border border-black/10" />
                    <figcaption className="mt-1">
                      <a
                        href={src}
                        download
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-teal-deep hover:text-teal-primary"
                      >
                        <Download size={12} />
                        ダウンロード
                      </a>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="mt-1 flex items-center gap-2 px-1 text-[11px] text-ink/40">
          {message.modelKey && <span>{modelLabel(message.modelKey)}</span>}
          {aborted && <span>停止しました</span>}
        </div>
      </div>
    </div>
  );
}
