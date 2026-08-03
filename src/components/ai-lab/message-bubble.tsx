"use client";

import { AlertCircle, Download, FileImage, FileSpreadsheet, FileText, Paperclip, Presentation } from "lucide-react";
import { labErrorMessage } from "@/lib/ai-lab/limits";
import { modelLabel } from "@/lib/ai-lab/models";
import type { LabUiFile, LabUiMessage } from "@/lib/ai-lab/ui-types";
import { Markdown } from "./markdown";

/** 拡張子ではなくMIMEで見分ける（サーバー側が正規化済みのため）。 */
function FileIcon({ mime }: { mime: string }) {
  const cls = "shrink-0 text-teal-deep";
  if (mime.includes("spreadsheet") || mime === "text/csv") return <FileSpreadsheet size={15} className={cls} />;
  if (mime.includes("presentation")) return <Presentation size={15} className={cls} />;
  if (mime.startsWith("image/")) return <FileImage size={15} className={cls} />;
  return <FileText size={15} className={cls} />;
}

/** 受講者が添付したファイルの小さな表示。画像はサムネイルにする。 */
function FileChip({ file }: { file: LabUiFile }) {
  if (file.mime.startsWith("image/")) {
    return (
      <a href={file.url} target="_blank" rel="noopener noreferrer" className="block">
        {/* 署名URL(外部ホスト)のため next/image は使わない */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={file.url} alt={file.fileName} className="h-16 w-16 rounded-lg border border-black/10 object-cover" />
      </a>
    );
  }
  return (
    <a
      href={file.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-ink/80 hover:bg-mist-soft"
    >
      <Paperclip size={12} className="shrink-0 text-ink/40" />
      <span className="truncate">{file.fileName}</span>
    </a>
  );
}

export function MessageBubble({ message, streaming }: { message: LabUiMessage; streaming?: boolean }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] min-w-0">
          <div className="rounded-2xl rounded-br-sm bg-teal-primary px-4 py-2.5 text-sm text-white whitespace-pre-wrap leading-relaxed">
            {message.content}
          </div>
          {message.attachments.length > 0 && (
            <div className="mt-1 flex flex-wrap justify-end gap-1.5">
              {message.attachments.map((f) => (
                <FileChip key={f.id} file={f} />
              ))}
            </div>
          )}
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
            {message.files.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-black/[0.06] pt-3">
                <p className="text-[11px] font-semibold text-ink/50">作成されたファイル</p>
                {message.files.map((f) => (
                  <a
                    key={f.id}
                    href={f.url}
                    download={f.fileName}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-xl border border-black/10 px-3 py-2 text-sm transition-colors hover:bg-mist-soft"
                  >
                    <FileIcon mime={f.mime} />
                    <span className="min-w-0 flex-1 truncate font-medium text-ink/90">{f.fileName}</span>
                    <Download size={14} className="shrink-0 text-teal-deep" />
                  </a>
                ))}
              </div>
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
