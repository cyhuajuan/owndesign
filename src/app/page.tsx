import { revalidatePath } from "next/cache";

import {
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { ChatShell } from "@/components/chat-shell";
import { ControlBar } from "@/components/control-bar";
import { MessageComposer } from "@/components/message-composer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createConversationService,
  createProjectService,
} from "@/lib/hjdesign";
import {
  ArrowRightLeftIcon,
  FolderIcon,
  HashIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";

async function createProjectFromControlBar(
  name: string,
  description?: string,
) {
  "use server";

  const trimmedName = name.trim();
  const trimmedDescription = description?.trim();

  if (!trimmedName) {
    return;
  }

  await createProjectService().createProject({
    name: trimmedName,
    description: trimmedDescription || undefined,
  });
  revalidatePath("/");
}

async function renameProjectAction(formData: FormData) {
  "use server";

  const projectId = String(formData.get("projectId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const descriptionValue = String(formData.get("description") ?? "").trim();

  if (!projectId || !name) {
    return;
  }

  await createProjectService().renameProject(projectId, {
    name,
    description: descriptionValue || undefined,
  });
  revalidatePath("/");
}

async function switchProjectFromControlBar(projectId: string) {
  "use server";

  if (!projectId) {
    return;
  }

  await createProjectService().switchProject(projectId);
  revalidatePath("/");
}

async function switchProjectAction(formData: FormData) {
  "use server";

  const projectId = String(formData.get("projectId") ?? "");

  if (!projectId) {
    return;
  }

  await createProjectService().switchProject(projectId);
  revalidatePath("/");
}

async function deleteProjectAction(formData: FormData) {
  "use server";

  const projectId = String(formData.get("projectId") ?? "");

  if (!projectId) {
    return;
  }

  await createProjectService().deleteProject(projectId);
  revalidatePath("/");
}

async function createConversationFromControlBar(projectId: string) {
  "use server";

  if (!projectId) {
    return;
  }

  await createConversationService().createConversation(projectId);
  revalidatePath("/");
}

async function switchConversationFromControlBar(
  projectId: string,
  conversationId: string,
) {
  "use server";

  if (!projectId || !conversationId) {
    return;
  }

  await createConversationService().switchConversation(projectId, conversationId);
  revalidatePath("/");
}

async function switchConversationAction(formData: FormData) {
  "use server";

  const projectId = String(formData.get("projectId") ?? "");
  const conversationId = String(formData.get("conversationId") ?? "");

  if (!projectId || !conversationId) {
    return;
  }

  await createConversationService().switchConversation(projectId, conversationId);
  revalidatePath("/");
}

async function renameConversationAction(formData: FormData) {
  "use server";

  const projectId = String(formData.get("projectId") ?? "");
  const conversationId = String(formData.get("conversationId") ?? "");
  const title = String(formData.get("title") ?? "").trim();

  if (!projectId || !conversationId || !title) {
    return;
  }

  await createConversationService().renameConversation(projectId, conversationId, {
    title,
  });
  revalidatePath("/");
}

async function deleteConversationAction(formData: FormData) {
  "use server";

  const projectId = String(formData.get("projectId") ?? "");
  const conversationId = String(formData.get("conversationId") ?? "");

  if (!projectId || !conversationId) {
    return;
  }

  await createConversationService().deleteConversation(projectId, conversationId);
  revalidatePath("/");
}

async function appendMessageAction(formData: FormData) {
  "use server";

  const projectId = String(formData.get("projectId") ?? "");
  const conversationId = String(formData.get("conversationId") ?? "");
  const content = String(formData.get("content") ?? "").trim();

  if (!projectId || !conversationId || !content) {
    return;
  }

  await createConversationService().sendUserMessage(
    projectId,
    conversationId,
    content,
  );
  revalidatePath("/");
}

export default async function Home() {
  const projectState = await createProjectService().getProjectState();
  const activeProject = projectState.projects.find(
    (project) => project.id === projectState.activeProjectId,
  );
  const conversationState = activeProject
    ? await createConversationService().getConversationState(activeProject.id)
    : { activeConversationId: undefined, conversations: [] };
  const activeConversation = conversationState.conversations.find(
    (conversation) =>
      conversation.id === conversationState.activeConversationId,
  );

  return (
    <ChatShell
      composer={
        activeProject && activeConversation ? (
          <MessageComposer
            action={appendMessageAction}
            conversationId={activeConversation.id}
            projectId={activeProject.id}
          />
        ) : (
          <ConversationEmptyState
            className="min-h-28 pt-4"
            description="请先创建项目，再开始发送消息。"
            icon={<PlusIcon />}
            title="输入区暂不可用"
          />
        )
      }
      controlBar={
        <ControlBar
          activeConversationId={conversationState.activeConversationId}
          activeProjectId={projectState.activeProjectId}
          conversations={conversationState.conversations}
          onCreateConversation={async () => {
            "use server";

            await createConversationFromControlBar(activeProject?.id ?? "");
          }}
          onCreateProject={createProjectFromControlBar}
          onSelectConversation={async (conversationId) => {
            "use server";

            await switchConversationFromControlBar(
              activeProject?.id ?? "",
              conversationId,
            );
          }}
          onSelectProject={switchProjectFromControlBar}
          projects={projectState.projects}
        />
      }
      messageHistory={
        activeConversation ? (
          activeConversation.messages.length === 0 ? (
            <ConversationEmptyState
              description="发送第一条消息后，会自动生成会话标题。"
              icon={<MessageSquareIcon />}
              title="暂无消息"
            />
          ) : (
            activeConversation.messages.map((message, index) => (
              <Message
                from={getMessageRole(message)}
                key={`${activeConversation.id}-${index}`}
              >
                <MessageContent>{formatMessageContent(message)}</MessageContent>
              </Message>
            ))
          )
        ) : (
          <ConversationEmptyState
            description="选择或创建一个会话来填充这里。"
            icon={<MessageSquareIcon />}
            title="暂无当前会话"
          />
        )
      }
      previewBody={
        <div className="flex min-h-[32rem] flex-col gap-4 p-6">
          {activeProject ? (
            <iframe
              className="h-[calc(100vh-9rem)] min-h-[32rem] w-full overflow-hidden rounded-md border bg-white"
              key={`${activeProject.id}-${activeProject.updatedAt}`}
              sandbox="allow-scripts"
              src={`/api/projects/${activeProject.id}/preview?updatedAt=${encodeURIComponent(activeProject.updatedAt)}`}
              title={`${activeProject.name} HTML 预览`}
            />
          ) : (
            <Empty className="min-h-[32rem] rounded-md border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderIcon />
                </EmptyMedia>
                <EmptyTitle>暂无 HTML 预览</EmptyTitle>
                <EmptyDescription>
                  创建项目后，在左侧输入“设计一个 XXX 的界面”。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          <Card className="border-border/70 shadow-none">
            <CardHeader className="has-data-[slot=card-description]:grid-rows-[auto_auto_auto]">
              <div className="flex items-center justify-between gap-3">
                <Badge variant="outline">
                  <FolderIcon data-icon="inline-start" />
                  当前项目
                </Badge>
                {activeProject ? <Badge>进行中</Badge> : null}
              </div>
              <CardTitle className="text-2xl">
                {activeProject?.name || "暂无当前项目"}
              </CardTitle>
              <CardDescription>
                {activeProject?.description || "暂无项目描述"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-sm md:grid-cols-2">
                <div className="rounded-lg border bg-background p-3">
                  <dt className="flex items-center gap-2 font-medium">
                    <HashIcon data-icon="inline-start" />
                    项目 ID
                  </dt>
                  <dd className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {projectState.activeProjectId || "无"}
                  </dd>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <dt className="flex items-center gap-2 font-medium">
                    <MessageSquareIcon data-icon="inline-start" />
                    当前会话 ID
                  </dt>
                  <dd className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {conversationState.activeConversationId || "无"}
                  </dd>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <dt className="font-medium">创建时间</dt>
                  <dd className="mt-1 text-muted-foreground">
                    {activeProject?.createdAt || "暂无"}
                  </dd>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <dt className="font-medium">更新时间</dt>
                  <dd className="mt-1 text-muted-foreground">
                    {activeProject?.updatedAt || "暂无"}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/70 shadow-none">
              <CardHeader>
                <CardTitle>项目</CardTitle>
                <CardDescription>
                  按项目组织工作区和共享输出区域。
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {projectState.projects.length === 0 ? (
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <FolderIcon />
                      </EmptyMedia>
                      <EmptyTitle>暂无项目</EmptyTitle>
                      <EmptyDescription>
                        创建一个项目来启动第一段会话。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  projectState.projects.map((project) => {
                    const isActive = project.id === projectState.activeProjectId;

                    return (
                      <Card key={project.id} size="sm" className="shadow-none">
                        <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <CardTitle className="truncate">
                              {project.name}
                            </CardTitle>
                            <CardDescription>
                              {project.description || "暂无项目描述"}
                            </CardDescription>
                          </div>
                          {isActive ? (
                            <Badge>当前</Badge>
                          ) : null}
                        </div>
                        </CardHeader>
                        <CardContent className="flex flex-wrap gap-2">
                          {!isActive ? (
                            <form action={switchProjectAction}>
                              <input
                                type="hidden"
                                name="projectId"
                                value={project.id}
                              />
                              <Button
                                size="sm"
                                type="submit"
                                variant="outline"
                              >
                                <ArrowRightLeftIcon data-icon="inline-start" />
                                切换
                              </Button>
                            </form>
                          ) : null}
                          <Dialog>
                            <DialogTrigger
                              render={
                                <Button size="sm" type="button" variant="outline" />
                              }
                            >
                              <PencilIcon data-icon="inline-start" />
                              重命名
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>重命名项目</DialogTitle>
                                <DialogDescription>
                                  更新这个项目的名称和描述。
                                </DialogDescription>
                              </DialogHeader>
                            <form
                              action={renameProjectAction}
                            >
                              <input
                                type="hidden"
                                name="projectId"
                                value={project.id}
                              />
                              <FieldGroup>
                                <Field>
                                  <FieldLabel htmlFor={`project-name-${project.id}`}>
                                    项目名称
                                  </FieldLabel>
                                  <Input
                                    id={`project-name-${project.id}`}
                                    type="text"
                                    name="name"
                                    defaultValue={project.name}
                                    required
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel
                                    htmlFor={`project-description-${project.id}`}
                                  >
                                    项目描述
                                  </FieldLabel>
                                  <Textarea
                                    className="min-h-20"
                                    id={`project-description-${project.id}`}
                                    name="description"
                                    defaultValue={project.description}
                                  />
                                </Field>
                              </FieldGroup>
                              <DialogFooter className="mt-4">
                                <Button type="submit">
                                  <SaveIcon data-icon="inline-start" />
                                  保存重命名
                                </Button>
                              </DialogFooter>
                            </form>
                            </DialogContent>
                          </Dialog>
                          <form action={deleteProjectAction}>
                            <input
                              type="hidden"
                              name="projectId"
                              value={project.id}
                            />
                            <Button
                              size="sm"
                              type="submit"
                              variant="destructive"
                            >
                              <Trash2Icon data-icon="inline-start" />
                              删除
                            </Button>
                          </form>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </CardContent>
            </Card>

            <Card className="border-border/70 shadow-none">
              <CardHeader>
                <CardTitle>会话</CardTitle>
                <CardDescription>
                  当前项目中的对话线索。
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {activeProject ? (
                  conversationState.conversations.length === 0 ? (
                    <Empty>
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <MessageSquareIcon />
                        </EmptyMedia>
                        <EmptyTitle>暂无会话</EmptyTitle>
                        <EmptyDescription>
                          从控制栏创建一段会话。
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : conversationState.conversations.map((conversation) => {
                    const isActive =
                      conversation.id === conversationState.activeConversationId;

                    return (
                      <Card
                        key={conversation.id}
                        size="sm"
                        className="shadow-none"
                      >
                        <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <CardTitle className="truncate">
                              {conversation.title}
                            </CardTitle>
                            <CardDescription>
                              更新于 {conversation.updatedAt}
                            </CardDescription>
                          </div>
                          {isActive ? (
                            <Badge variant="secondary">当前</Badge>
                          ) : null}
                        </div>
                        </CardHeader>
                        <CardContent className="flex flex-wrap gap-2">
                          {!isActive ? (
                            <form action={switchConversationAction}>
                              <input
                                type="hidden"
                                name="projectId"
                                value={activeProject.id}
                              />
                              <input
                                type="hidden"
                                name="conversationId"
                                value={conversation.id}
                              />
                              <Button
                                size="sm"
                                type="submit"
                                variant="outline"
                              >
                                <ArrowRightLeftIcon data-icon="inline-start" />
                                切换
                              </Button>
                            </form>
                          ) : null}
                          <Dialog>
                            <DialogTrigger
                              render={
                                <Button size="sm" type="button" variant="outline" />
                              }
                            >
                              <PencilIcon data-icon="inline-start" />
                              重命名
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>重命名会话</DialogTitle>
                                <DialogDescription>
                                  更新会话标题。
                                </DialogDescription>
                              </DialogHeader>
                            <form
                              action={renameConversationAction}
                            >
                              <input
                                type="hidden"
                                name="projectId"
                                value={activeProject.id}
                              />
                              <input
                                type="hidden"
                                name="conversationId"
                                value={conversation.id}
                              />
                              <FieldGroup>
                                <Field>
                                  <FieldLabel
                                    htmlFor={`conversation-title-${conversation.id}`}
                                  >
                                    会话标题
                                  </FieldLabel>
                                  <Input
                                    id={`conversation-title-${conversation.id}`}
                                    type="text"
                                    name="title"
                                    defaultValue={conversation.title}
                                    required
                                  />
                                </Field>
                              </FieldGroup>
                              <DialogFooter className="mt-4">
                                <Button type="submit">
                                  <SaveIcon data-icon="inline-start" />
                                  保存标题
                                </Button>
                              </DialogFooter>
                            </form>
                            </DialogContent>
                          </Dialog>
                          <form action={deleteConversationAction}>
                            <input
                              type="hidden"
                              name="projectId"
                              value={activeProject.id}
                            />
                            <input
                              type="hidden"
                              name="conversationId"
                              value={conversation.id}
                            />
                            <Button
                              size="sm"
                              type="submit"
                              variant="destructive"
                            >
                              <Trash2Icon data-icon="inline-start" />
                              删除
                            </Button>
                          </form>
                        </CardContent>
                      </Card>
                    );
                  })
                ) : (
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <MessageSquareIcon />
                      </EmptyMedia>
                      <EmptyTitle>暂无当前项目</EmptyTitle>
                      <EmptyDescription>
                        请先创建项目，再开始管理会话。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      }
      previewDescription="当前项目的 HTML 输出通过 iframe 实时预览。"
      previewTitle={activeProject?.name || "预览面板"}
    />
  );
}

function formatMessageContent(message: unknown) {
  if (
    typeof message === "object" &&
    message !== null &&
    "content" in message &&
    typeof message.content === "string"
  ) {
    return message.content;
  }

  return JSON.stringify(message);
}

function getMessageRole(message: unknown): "assistant" | "user" {
  if (
    typeof message === "object" &&
    message !== null &&
    "role" in message &&
    (message.role === "assistant" || message.role === "user")
  ) {
    return message.role;
  }

  return "assistant";
}
