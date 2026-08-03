/** サーバー(RSC)からクライアントコンポーネントへ渡す、AI Lab 画面用の最小データ形。 */

export interface LabUiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  modelKey: string | null;
  /** 生成画像の署名URL(期限付き)。 */
  images: string[];
  errorCode: string | null;
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
