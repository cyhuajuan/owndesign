import {
  ConversationRecord,
  WorkspaceStore,
} from "./workspace-store";

type ConversationServiceOptions = {
  workspaceStore: WorkspaceStore;
  now?: () => string;
  createId?: () => string;
};

type RenameConversationInput = {
  title: string;
};

type ConversationState = {
  activeConversationId?: string;
  conversations: ConversationRecord[];
};

type UserMessage = {
  content: string;
  createdAt: string;
};

const DEFAULT_CONVERSATION_TITLE = "New conversation";

export class ConversationService {
  private readonly workspaceStore: WorkspaceStore;
  private readonly now: () => string;
  private readonly createId: () => string;

  constructor(options: ConversationServiceOptions) {
    this.workspaceStore = options.workspaceStore;
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  async createConversation(projectId: string) {
    const timestamp = this.now();
    const conversation: ConversationRecord = {
      id: this.createId(),
      projectId,
      title: DEFAULT_CONVERSATION_TITLE,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    };

    await this.workspaceStore.createConversation(conversation);
    await this.setActiveConversation(projectId, conversation.id);

    return conversation;
  }

  async renameConversation(
    projectId: string,
    conversationId: string,
    input: RenameConversationInput,
  ) {
    const existingConversation = await this.workspaceStore.getConversation(
      projectId,
      conversationId,
    );
    const updatedConversation: ConversationRecord = {
      ...existingConversation,
      title: input.title,
      titleManuallySet: true,
      updatedAt: this.now(),
    };

    return this.workspaceStore.updateConversation(
      projectId,
      conversationId,
      updatedConversation,
    );
  }

  async switchConversation(projectId: string, conversationId: string) {
    await this.workspaceStore.getConversation(projectId, conversationId);
    await this.setActiveConversation(projectId, conversationId);
  }

  async appendUserMessage(
    projectId: string,
    conversationId: string,
    content: string,
  ) {
    const existingConversation = await this.workspaceStore.getConversation(
      projectId,
      conversationId,
    );
    const timestamp = this.now();
    const messages = [
      ...existingConversation.messages,
      { content, createdAt: timestamp } satisfies UserMessage,
    ];
    const updatedConversation: ConversationRecord = {
      ...existingConversation,
      title:
        !existingConversation.titleManuallySet &&
        existingConversation.title === DEFAULT_CONVERSATION_TITLE &&
        existingConversation.messages.length === 0
          ? summarizeConversationTitle(content)
          : existingConversation.title,
      messages,
      updatedAt: timestamp,
      lastMessageAt: timestamp,
    };

    return this.workspaceStore.updateConversation(
      projectId,
      conversationId,
      updatedConversation,
    );
  }

  async deleteConversation(projectId: string, conversationId: string) {
    const currentState = await this.workspaceStore.readWorkspaceState();

    await this.workspaceStore.deleteConversation(projectId, conversationId);

    let remainingConversations = await this.workspaceStore.listConversations(
      projectId,
    );

    if (remainingConversations.length === 0) {
      const replacementConversation = await this.createConversation(projectId);
      remainingConversations = [replacementConversation];
    } else if (currentState.activeConversationId === conversationId) {
      await this.setActiveConversation(projectId, remainingConversations[0]!.id);
    }

    return remainingConversations;
  }

  async getConversationState(projectId: string): Promise<ConversationState> {
    const conversations = await this.workspaceStore.listConversations(projectId);
    const workspaceState = await this.workspaceStore.readWorkspaceState();

    return {
      activeConversationId: workspaceState.activeConversationId,
      conversations,
    };
  }

  private async setActiveConversation(projectId: string, conversationId: string) {
    const workspaceState = await this.workspaceStore.readWorkspaceState();

    await this.workspaceStore.writeWorkspaceState({
      ...workspaceState,
      activeProjectId: projectId,
      activeConversationId: conversationId,
    });
  }
}

function summarizeConversationTitle(content: string) {
  return content.trim().replace(/\s+/g, " ").slice(0, 80);
}
