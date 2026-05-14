type MockReplyInput = {
  projectId: string;
  conversationId: string;
  content: string;
};

export class MockReplyEngine {
  generateReply(input: MockReplyInput) {
    return `Mock reply: captured your request for Project ${input.projectId} in Conversation ${input.conversationId}.`;
  }
}
