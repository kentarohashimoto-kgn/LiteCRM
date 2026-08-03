/** スライド作成画面へ渡す最小データ形。 */

export interface LabUiSlideItem {
  position: number;
  title: string;
  summary: string;
  imagePrompt: string;
  notes: string;
  status: "pending" | "done" | "failed";
  errorCode: string | null;
  /** 生成済み画像の署名URL(期限付き)。 */
  imageUrl: string | null;
}

export interface LabUiDeck {
  id: string;
  title: string;
  instruction: string;
  quality: "low" | "medium" | "high";
  status: "draft" | "generating" | "ready" | "failed";
  createdAt: string;
  items: LabUiSlideItem[];
  /** 統合済み pptx のダウンロードURL。 */
  pptxUrl: string | null;
  pptxFileName: string | null;
}

export interface LabUiDeckSummary {
  id: string;
  title: string;
  status: LabUiDeck["status"];
  createdAt: string;
  total: number;
  done: number;
}
