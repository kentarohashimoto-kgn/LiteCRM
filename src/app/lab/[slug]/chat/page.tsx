import { ChatScreen } from "@/components/ai-lab/chat-screen";

// 受講者ごとに内容が変わるため、常にリクエスト時に描画する。
export const dynamic = "force-dynamic";

export default function LabChatPage({ params }: { params: { slug: string } }) {
  return <ChatScreen slug={params.slug} conversationId={null} />;
}
