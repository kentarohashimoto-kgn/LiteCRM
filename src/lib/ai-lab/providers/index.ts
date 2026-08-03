import { resolveModel, type LabModel } from "../models";
import { anthropicChat } from "./anthropic";
import { openaiChat, openaiImage } from "./openai";
import { LabProviderError, type ChatProvider, type ImageProvider } from "./types";

export * from "./types";

export function getChatProvider(model: LabModel): ChatProvider {
  if (model.kind !== "text") throw new LabProviderError("provider_error", "テキスト生成に使えないモデルです");
  return model.provider === "anthropic" ? anthropicChat : openaiChat;
}

/**
 * 画像生成の差し替え点。現在は OpenAI(gpt-image-2)のみ。
 * 別プロバイダを足す場合もここだけを触れば済むようにしている。
 */
export function getImageProvider(model: LabModel): ImageProvider {
  if (model.kind !== "image") throw new LabProviderError("provider_error", "画像生成に使えないモデルです");
  return openaiImage;
}

export function requireModel(key: string): LabModel {
  const model = resolveModel(key);
  if (!model) throw new LabProviderError("provider_error", "不明なモデルです");
  return model;
}
