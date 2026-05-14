type MockReplyInput = {
  projectId: string;
  conversationId: string;
  content: string;
};

export class MockReplyEngine {
  generateReply(input: MockReplyInput) {
    return `模拟回复：已收到你在项目 ${input.projectId}、会话 ${input.conversationId} 中的请求。`;
  }
}
