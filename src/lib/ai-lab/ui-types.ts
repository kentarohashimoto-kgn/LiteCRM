/** サーバー(RSC)からクライアントコンポーネントへ渡す、AI Lab 画面用の最小データ形。 */

/** チャットに表示するファイル(受講者の添付・AIの生成物のどちらも)。 */
export interface LabUiFile {
  id: string;
  fileName: string;
  mime: string;
  /** 署名URL(期限付き)。画像はそのまま表示、他はダウンロードリンクにする。 */
  url: string;
}

export interface LabUiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  modelKey: string | null;
  /** 生成画像の署名URL(期限付き)。 */
  images: string[];
  /** 受講者が添付したファイル。 */
  attachments: LabUiFile[];
  /** AIが生成したファイル(xlsx等)。 */
  files: LabUiFile[];
  errorCode: string | null;
}

/** 送信前にアップロード済みの添付。 */
export interface LabPendingAttachment {
  id: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  kind: string;
}

export interface LabUiModel {
  key: string;
  label: string;
  hint: string;
  kind: "text" | "image";
}

export interface LabUiPreset {
  id: string;
  name: string;
  description: string | null;
  /** 設定されていればモデル固定。 */
  modelKey: string | null;
}

export interface LabUiConversation {
  id: string;
  title: string;
  updatedAt: string;
}

/** 受講者の一括発行結果。初期パスワードは発行直後の画面表示にのみ使う。 */
export interface IssuedLabUser {
  loginId: string;
  displayName: string;
  password: string;
}
