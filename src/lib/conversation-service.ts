import {
  ConversationRecord,
  WorkspaceStore,
} from "./workspace-store";
import {
  AiSdkDesignPageAgent,
  DesignPageAgent,
} from "./design-page-agent";
import {
  getFirstUserMessageText,
  HJDesignUIMessage,
} from "./chat-messages";

type ConversationServiceOptions = {
  workspaceStore: WorkspaceStore;
  now?: () => string;
  createId?: () => string;
  designPageAgent?: DesignPageAgent;
};

type RenameConversationInput = {
  title: string;
};

type ConversationState = {
  activeConversationId?: string;
  conversations: ConversationRecord[];
};

type UserMessage = {
  role: "user";
  content: string;
  createdAt: string;
};

type AssistantMessage = {
  role: "assistant";
  content: string;
  createdAt: string;
};

const DEFAULT_CONVERSATION_TITLE = "新建会话";

export class ConversationService {
  private readonly workspaceStore: WorkspaceStore;
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly designPageAgent: DesignPageAgent;

  constructor(options: ConversationServiceOptions) {
    this.workspaceStore = options.workspaceStore;
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.designPageAgent =
      options.designPageAgent ?? new AiSdkDesignPageAgent(this.workspaceStore);
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

  async sendUserMessage(
    projectId: string,
    conversationId: string,
    content: string,
  ) {
    const existingConversation = await this.workspaceStore.getConversation(
      projectId,
      conversationId,
    );
    const project = await this.workspaceStore.getProject(projectId);
    const timestamp = this.now();
    const userMessage = {
      role: "user",
      content,
      createdAt: timestamp,
    } satisfies UserMessage;
    const agentResult = await this.generateProjectOutputSafely({
      content,
      conversationId,
      outputType: project.outputType,
      projectId,
      projectName: project.name,
    });
    const mockReply = {
      role: "assistant",
      content: agentResult.content,
      createdAt: timestamp,
    } satisfies AssistantMessage;
    const messages = [
      ...existingConversation.messages,
      userMessage,
      mockReply,
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

    const updatedProject = {
      ...project,
      updatedAt: timestamp,
    };

    await this.workspaceStore.updateProject(projectId, updatedProject);

    return this.workspaceStore.updateConversation(
      projectId,
      conversationId,
      updatedConversation,
    );
  }

  async saveUIMessageStream(
    projectId: string,
    conversationId: string,
    messages: HJDesignUIMessage[],
  ) {
    const existingConversation = await this.workspaceStore.getConversation(
      projectId,
      conversationId,
    );
    const project = await this.workspaceStore.getProject(projectId);
    const timestamp = this.now();
    const firstUserMessageText = getFirstUserMessageText(messages);
    const updatedConversation: ConversationRecord = {
      ...existingConversation,
      title:
        !existingConversation.titleManuallySet &&
        existingConversation.title === DEFAULT_CONVERSATION_TITLE &&
        existingConversation.messages.length === 0 &&
        firstUserMessageText
          ? summarizeConversationTitle(firstUserMessageText)
          : existingConversation.title,
      messages,
      updatedAt: timestamp,
      lastMessageAt: timestamp,
    };
    const updatedProject = {
      ...project,
      updatedAt: timestamp,
    };

    await this.workspaceStore.updateProject(projectId, updatedProject);

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

  private async generateProjectOutputSafely(
    input: Parameters<DesignPageAgent["generateProjectOutput"]>[0],
  ) {
    try {
      return await this.designPageAgent.generateProjectOutput(input);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown design agent error";

      return {
        content: `生成失败：${message}`,
      };
    }
  }
}

function summarizeConversationTitle(content: string) {
  return content.trim().replace(/\s+/g, " ").slice(0, 80);
}
