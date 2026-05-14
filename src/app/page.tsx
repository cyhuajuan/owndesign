import { revalidatePath } from "next/cache";

import { Message, MessageContent } from "@/components/ai-elements/message";
import { ChatShell } from "@/components/chat-shell";
import {
  createConversationService,
  createProjectService,
} from "@/lib/hjdesign";

async function createProjectAction(formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "").trim();
  const descriptionValue = String(formData.get("description") ?? "").trim();

  if (!name) {
    return;
  }

  await createProjectService().createProject({
    name,
    description: descriptionValue || undefined,
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

async function createConversationAction(formData: FormData) {
  "use server";

  const projectId = String(formData.get("projectId") ?? "");

  if (!projectId) {
    return;
  }

  await createConversationService().createConversation(projectId);
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
          <form action={appendMessageAction} className="space-y-3 pt-4">
            <input type="hidden" name="projectId" value={activeProject.id} />
            <input
              type="hidden"
              name="conversationId"
              value={activeConversation.id}
            />
            <textarea
              className="min-h-28 w-full rounded-2xl border border-stone-300 bg-white px-3 py-3 text-sm outline-none ring-0"
              name="content"
              placeholder="Describe what you want this Conversation to explore..."
              required
            />
            <button
              className="rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white"
              type="submit"
            >
              Add user message
            </button>
          </form>
        ) : (
          <p className="pt-4 text-sm text-stone-500">
            Create a Project first to start messaging.
          </p>
        )
      }
      controlBar={
        <div className="flex flex-wrap gap-2">
          <form action={createProjectAction} className="flex flex-wrap gap-2">
            <input
              className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm"
              type="text"
              name="name"
              placeholder="New Project"
              required
            />
            <input
              className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm"
              type="text"
              name="description"
              placeholder="Description"
            />
            <button
              className="rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white"
              type="submit"
            >
              Create Project
            </button>
          </form>

          {projectState.projects.map((project) => {
            const isActive = project.id === projectState.activeProjectId;

            return (
              <form action={switchProjectAction} key={project.id}>
                <input type="hidden" name="projectId" value={project.id} />
                <button
                  className={`rounded-full px-3 py-1.5 text-sm ${
                    isActive
                      ? "bg-stone-900 text-white"
                      : "border border-stone-300 bg-white text-stone-700"
                  }`}
                  type="submit"
                >
                  {project.name}
                </button>
              </form>
            );
          })}

          {activeProject
            ? conversationState.conversations.map((conversation) => {
                const isActive =
                  conversation.id === conversationState.activeConversationId;

                return (
                  <form action={switchConversationAction} key={conversation.id}>
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
                    <button
                      className={`rounded-full px-3 py-1.5 text-sm ${
                        isActive
                          ? "bg-amber-100 text-amber-900"
                          : "border border-stone-300 bg-white text-stone-700"
                      }`}
                      type="submit"
                    >
                      {conversation.title}
                    </button>
                  </form>
                );
              })
            : null}

          {activeProject ? (
            <form action={createConversationAction}>
              <input type="hidden" name="projectId" value={activeProject.id} />
              <button
                className="rounded-full border border-dashed border-stone-400 px-3 py-1.5 text-sm text-stone-700"
                type="submit"
              >
                New Conversation
              </button>
            </form>
          ) : null}
        </div>
      }
      messageHistory={
        activeConversation ? (
          activeConversation.messages.length === 0 ? (
            <p className="rounded-2xl bg-stone-50 p-3 text-sm text-stone-500">
              No messages yet. Send first message to trigger automatic title generation.
            </p>
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
          <p className="rounded-2xl bg-stone-50 p-3 text-sm text-stone-500">
            No active Conversation yet.
          </p>
        )
      }
      previewBody={
        <div className="flex min-h-[32rem] flex-col gap-4 p-6">
          <section className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-stone-500">
              Active Project
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-stone-900">
              {activeProject?.name || "No active Project"}
            </h2>
            <p className="mt-2 text-sm text-stone-600">
              {activeProject?.description || "No Project description"}
            </p>
            <dl className="mt-4 grid gap-2 text-sm text-stone-600 md:grid-cols-2">
              <div>
                <dt className="font-medium text-stone-800">Project ID</dt>
                <dd className="font-mono text-xs">
                  {projectState.activeProjectId || "None"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-stone-800">Active Conversation ID</dt>
                <dd className="font-mono text-xs">
                  {conversationState.activeConversationId || "None"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-stone-800">Created</dt>
                <dd>{activeProject?.createdAt || "N/A"}</dd>
              </div>
              <div>
                <dt className="font-medium text-stone-800">Updated</dt>
                <dd>{activeProject?.updatedAt || "N/A"}</dd>
              </div>
            </dl>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-stone-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-stone-800">Projects</h3>
              <div className="mt-4 space-y-3">
                {projectState.projects.length === 0 ? (
                  <p className="text-sm text-stone-500">
                    No Projects yet. Create one to bootstrap the first Conversation.
                  </p>
                ) : (
                  projectState.projects.map((project) => {
                    const isActive = project.id === projectState.activeProjectId;

                    return (
                      <article
                        key={project.id}
                        className="rounded-2xl border border-stone-200 bg-stone-50 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-stone-900">{project.name}</p>
                            <p className="mt-1 text-sm text-stone-500">
                              {project.description || "No Project description"}
                            </p>
                          </div>
                          {isActive ? (
                            <span className="rounded-full bg-stone-900 px-2 py-1 text-xs text-white">
                              Active
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {!isActive ? (
                            <form action={switchProjectAction}>
                              <input
                                type="hidden"
                                name="projectId"
                                value={project.id}
                              />
                              <button
                                className="rounded-full border border-stone-300 px-3 py-1.5 text-xs"
                                type="submit"
                              >
                                Switch
                              </button>
                            </form>
                          ) : null}
                          <details>
                            <summary className="cursor-pointer list-none rounded-full border border-stone-300 px-3 py-1.5 text-xs">
                              Rename
                            </summary>
                            <form
                              action={renameProjectAction}
                              className="mt-3 space-y-2"
                            >
                              <input
                                type="hidden"
                                name="projectId"
                                value={project.id}
                              />
                              <input
                                className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm"
                                type="text"
                                name="name"
                                defaultValue={project.name}
                                required
                              />
                              <textarea
                                className="min-h-20 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm"
                                name="description"
                                defaultValue={project.description}
                              />
                              <button
                                className="rounded-full bg-amber-500 px-3 py-1.5 text-xs font-semibold text-stone-950"
                                type="submit"
                              >
                                Save rename
                              </button>
                            </form>
                          </details>
                          <form action={deleteProjectAction}>
                            <input
                              type="hidden"
                              name="projectId"
                              value={project.id}
                            />
                            <button
                              className="rounded-full border border-red-300 px-3 py-1.5 text-xs text-red-600"
                              type="submit"
                            >
                              Delete
                            </button>
                          </form>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-stone-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-stone-800">
                Conversations
              </h3>
              <div className="mt-4 space-y-3">
                {activeProject ? (
                  conversationState.conversations.map((conversation) => {
                    const isActive =
                      conversation.id === conversationState.activeConversationId;

                    return (
                      <article
                        key={conversation.id}
                        className="rounded-2xl border border-stone-200 bg-stone-50 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-stone-900">
                              {conversation.title}
                            </p>
                            <p className="mt-1 text-xs text-stone-500">
                              Updated {conversation.updatedAt}
                            </p>
                          </div>
                          {isActive ? (
                            <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-900">
                              Active
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
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
                              <button
                                className="rounded-full border border-stone-300 px-3 py-1.5 text-xs"
                                type="submit"
                              >
                                Switch
                              </button>
                            </form>
                          ) : null}
                          <details>
                            <summary className="cursor-pointer list-none rounded-full border border-stone-300 px-3 py-1.5 text-xs">
                              Rename
                            </summary>
                            <form
                              action={renameConversationAction}
                              className="mt-3 space-y-2"
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
                              <input
                                className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm"
                                type="text"
                                name="title"
                                defaultValue={conversation.title}
                                required
                              />
                              <button
                                className="rounded-full bg-amber-500 px-3 py-1.5 text-xs font-semibold text-stone-950"
                                type="submit"
                              >
                                Save title
                              </button>
                            </form>
                          </details>
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
                            <button
                              className="rounded-full border border-red-300 px-3 py-1.5 text-xs text-red-600"
                              type="submit"
                            >
                              Delete
                            </button>
                          </form>
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <p className="text-sm text-stone-500">
                    Create a Project first to start managing Conversations.
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>
      }
      previewDescription="Preview Header holds pane toggle. Right pane carries active Project context and shared output surfaces."
      previewTitle={activeProject?.name || "Preview pane"}
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
