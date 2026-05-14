import { revalidatePath } from "next/cache";

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
    <div className="min-h-screen bg-stone-100 px-6 py-8 font-sans text-stone-900">
      <main className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[360px_1fr]">
        <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-6">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-stone-500">
              HJDesign
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Project shell
            </h1>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Create, switch, rename, and delete Projects backed by the local
              Workspace.
            </p>
          </div>

          <form action={createProjectAction} className="space-y-3 rounded-2xl bg-stone-50 p-4">
            <h2 className="text-sm font-semibold text-stone-700">New Project</h2>
            <input
              className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none ring-0"
              type="text"
              name="name"
              placeholder="Project name"
              required
            />
            <textarea
              className="min-h-24 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none ring-0"
              name="description"
              placeholder="Optional Project description"
            />
            <button
              className="rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white"
              type="submit"
            >
              Create Project
            </button>
          </form>

          <div className="mt-6 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
              Projects
            </h2>
            {projectState.projects.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-stone-300 p-4 text-sm text-stone-500">
                No Projects yet. Create one to bootstrap the first Conversation.
              </p>
            ) : (
              projectState.projects.map((project) => {
                const isActive = project.id === projectState.activeProjectId;

                return (
                  <article
                    key={project.id}
                    className={`rounded-2xl border p-4 ${
                      isActive
                        ? "border-stone-900 bg-stone-900 text-white"
                        : "border-stone-200 bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-base font-semibold">{project.name}</h3>
                        <p
                          className={`mt-1 text-sm ${
                            isActive ? "text-stone-300" : "text-stone-500"
                          }`}
                        >
                          {project.description || "No Project description"}
                        </p>
                      </div>
                      {isActive ? (
                        <span className="rounded-full border border-white/20 px-2 py-1 text-xs font-medium uppercase tracking-[0.16em] text-stone-200">
                          Active
                        </span>
                      ) : null}
                    </div>

                    <dl
                      className={`mt-4 grid gap-1 text-xs ${
                        isActive ? "text-stone-300" : "text-stone-500"
                      }`}
                    >
                      <div>
                        <dt className="inline font-medium">Created:</dt>{" "}
                        <dd className="inline">{project.createdAt}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">Updated:</dt>{" "}
                        <dd className="inline">{project.updatedAt}</dd>
                      </div>
                    </dl>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {!isActive ? (
                        <form action={switchProjectAction}>
                          <input type="hidden" name="projectId" value={project.id} />
                          <button
                            className="rounded-full border border-current px-3 py-1.5 text-xs font-medium"
                            type="submit"
                          >
                            Switch
                          </button>
                        </form>
                      ) : null}
                      <details className="group">
                        <summary className="cursor-pointer list-none rounded-full border border-current px-3 py-1.5 text-xs font-medium">
                          Rename
                        </summary>
                        <form
                          action={renameProjectAction}
                          className={`mt-3 space-y-2 rounded-2xl p-3 ${
                            isActive ? "bg-white/10" : "bg-stone-50"
                          }`}
                        >
                          <input type="hidden" name="projectId" value={project.id} />
                          <input
                            className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
                            type="text"
                            name="name"
                            defaultValue={project.name}
                            required
                          />
                          <textarea
                            className="min-h-20 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
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
                        <input type="hidden" name="projectId" value={project.id} />
                        <button
                          className="rounded-full border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600"
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
        </section>

        <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4 border-b border-stone-200 pb-4">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-stone-500">
                Active Project
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                {activeProject?.name || "No active Project"}
              </h2>
            </div>
            <div className="rounded-2xl bg-stone-100 px-4 py-3 text-right text-xs text-stone-500">
              <p>Active Project ID</p>
              <p className="mt-1 font-mono text-[11px] text-stone-700">
                {projectState.activeProjectId || "None"}
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl bg-stone-50 p-4">
              <h3 className="text-sm font-semibold text-stone-700">
                Project details
              </h3>
              <dl className="mt-3 space-y-2 text-sm text-stone-600">
                <div>
                  <dt className="font-medium text-stone-800">Description</dt>
                  <dd>{activeProject?.description || "No Project description"}</dd>
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
            </div>

            <div className="rounded-2xl bg-stone-900 p-4 text-stone-100">
              <h3 className="text-sm font-semibold">Bootstrap status</h3>
              <p className="mt-3 text-sm leading-6 text-stone-300">
                New Projects auto-create a first Conversation and persist active
                state to the local Workspace so reloads can recover the current
                Project context.
              </p>
              <div className="mt-4 rounded-2xl bg-white/10 p-3 text-xs text-stone-300">
                <p>Active Conversation ID</p>
                <p className="mt-1 font-mono text-[11px] text-stone-100">
                  {conversationState.activeConversationId || "None"}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-stone-200 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-stone-700">
                  Conversations
                </h3>
                <p className="mt-1 text-sm text-stone-500">
                  Manage per-Project Conversation threads stored as individual
                  files.
                </p>
              </div>
              {activeProject ? (
                <form action={createConversationAction}>
                  <input type="hidden" name="projectId" value={activeProject.id} />
                  <button
                    className="rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white"
                    type="submit"
                  >
                    New Conversation
                  </button>
                </form>
              ) : null}
            </div>

            {activeProject ? (
              <div className="mt-4 space-y-3">
                {conversationState.conversations.map((conversation) => {
                  const isActive =
                    conversation.id === conversationState.activeConversationId;

                  return (
                    <article
                      key={conversation.id}
                      className={`rounded-2xl border p-4 ${
                        isActive
                          ? "border-amber-300 bg-amber-50"
                          : "border-stone-200 bg-stone-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h4 className="text-sm font-semibold text-stone-900">
                            {conversation.title}
                          </h4>
                          <p className="mt-1 text-xs text-stone-500">
                            Updated {conversation.updatedAt}
                          </p>
                        </div>
                        {isActive ? (
                          <span className="rounded-full border border-amber-300 px-2 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-amber-700">
                            Active
                          </span>
                        ) : (
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
                              className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium"
                              type="submit"
                            >
                              Switch
                            </button>
                          </form>
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <details>
                          <summary className="cursor-pointer list-none rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium">
                            Rename
                          </summary>
                          <form
                            action={renameConversationAction}
                            className="mt-3 space-y-2 rounded-2xl bg-white p-3"
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
                              className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
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
                            className="rounded-full border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600"
                            type="submit"
                          >
                            Delete
                          </button>
                        </form>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="mt-4 text-sm text-stone-500">
                Create a Project first to start managing Conversations.
              </p>
            )}
          </div>

          <div className="mt-6 rounded-2xl border border-stone-200 p-4">
            <h3 className="text-sm font-semibold text-stone-700">
              Active Conversation
            </h3>
            {activeProject && activeConversation ? (
              <>
                <p className="mt-2 text-sm font-medium text-stone-900">
                  {activeConversation.title}
                </p>
                <div className="mt-4 space-y-3">
                  {activeConversation.messages.length === 0 ? (
                    <p className="rounded-2xl bg-stone-50 p-3 text-sm text-stone-500">
                      No messages yet. Send the first one to trigger automatic
                      title generation.
                    </p>
                  ) : (
                    activeConversation.messages.map((message, index) => (
                      <div
                        key={`${activeConversation.id}-${index}`}
                        className="rounded-2xl bg-stone-50 p-3 text-sm text-stone-700"
                      >
                        {formatMessageContent(message)}
                      </div>
                    ))
                  )}
                </div>

                <form action={appendMessageAction} className="mt-4 space-y-3">
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
              </>
            ) : (
              <p className="mt-2 text-sm text-stone-500">
                No active Conversation yet.
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
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
