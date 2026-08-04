import { ChatScreen } from "@/components/ai-lab/chat-screen";

export const dynamic = "force-dynamic";

export default async function LabConversationPage(
  props: {
    params: Promise<{ slug: string; conversationId: string }>;
  }
) {
  const params = await props.params;
  return <ChatScreen slug={params.slug} conversationId={params.conversationId} />;
}
