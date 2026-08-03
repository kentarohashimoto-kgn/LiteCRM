import { ChatScreen } from "@/components/ai-lab/chat-screen";

export const dynamic = "force-dynamic";

export default function LabConversationPage({
  params,
}: {
  params: { slug: string; conversationId: string };
}) {
  return <ChatScreen slug={params.slug} conversationId={params.conversationId} />;
}
