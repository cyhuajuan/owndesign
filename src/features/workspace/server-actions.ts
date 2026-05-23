import { revalidatePath } from "next/cache";

import {
  createConversationService,
  createProjectService,
} from "@/server/owndesign";
import { createSettingsService } from "@/server/settings/settings-service";
import type { InitialSetupInput } from "@/features/onboarding/components/initial-setup-guide";
import { buildWorkspaceHref } from "@/features/workspace/navigation";

export async function createProjectFromControlBar(
  name: string,
  description?: string,
) {
  "use server";

  const trimmedName = name.trim();
  const trimmedDescription = description?.trim();

  if (!trimmedName) {
    return;
  }

  const result = await createProjectService().createProject({
    name: trimmedName,
    description: trimmedDescription || undefined,
  });
  revalidatePath("/");

  return {
    href: buildWorkspaceHref(result.project.id, result.conversation.id),
  };
}

export async function renameProjectFromControlBar(
  projectId: string,
  name: string,
  description?: string,
) {
  "use server";

  const trimmedName = name.trim();
  const trimmedDescription = description?.trim();

  if (!projectId || !trimmedName) {
    return;
  }

  await createProjectService().renameProject(projectId, {
    name: trimmedName,
    description: trimmedDescription || undefined,
  });
  revalidatePath("/");
}

export async function deleteProjectFromControlBar(projectId: string) {
  "use server";

  if (!projectId) {
    return;
  }

  await createProjectService().deleteProject(projectId);
  const projectState = await createProjectService().getProjectState();
  const fallbackProject = projectState.projects[0];
  const fallbackConversation = fallbackProject
    ? (await createConversationService().getConversationState(fallbackProject.id))
        .conversations[0]
    : undefined;

  revalidatePath("/");

  return {
    href: buildWorkspaceHref(fallbackProject?.id, fallbackConversation?.id),
  };
}

export async function switchProjectFromControlBar(projectId: string) {
  "use server";

  if (!projectId) {
    return;
  }

  const conversationState =
    await createConversationService().getConversationState(projectId);
  const activeConversation = conversationState.conversations[0];

  revalidatePath("/");

  return {
    href: buildWorkspaceHref(projectId, activeConversation?.id),
  };
}

export async function createConversationFromControlBar(projectId: string) {
  "use server";

  if (!projectId) {
    return;
  }

  const conversation =
    await createConversationService().createConversation(projectId);
  revalidatePath("/");

  return {
    href: buildWorkspaceHref(projectId, conversation.id),
  };
}

export async function switchConversationFromControlBar(
  projectId: string,
  conversationId: string,
) {
  "use server";

  if (!projectId || !conversationId) {
    return;
  }

  await createConversationService().switchConversation(projectId, conversationId);
  revalidatePath("/");

  return {
    href: buildWorkspaceHref(projectId, conversationId),
  };
}

export async function renameConversationFromControlBar(
  projectId: string,
  conversationId: string,
  title: string,
) {
  "use server";

  const trimmedTitle = title.trim();

  if (!projectId || !conversationId || !trimmedTitle) {
    return;
  }

  await createConversationService().renameConversation(projectId, conversationId, {
    title: trimmedTitle,
  });
  revalidatePath("/");
}

export async function deleteConversationFromControlBar(
  projectId: string,
  conversationId: string,
  currentConversationId?: string,
) {
  "use server";

  if (!projectId || !conversationId) {
    return;
  }

  const remainingConversations =
    await createConversationService().deleteConversation(projectId, conversationId);
  const nextConversationId =
    currentConversationId === conversationId
      ? remainingConversations[0]?.id
      : currentConversationId;

  revalidatePath("/");

  return {
    href: buildWorkspaceHref(projectId, nextConversationId),
  };
}

export async function completeInitialSetup(input: InitialSetupInput) {
  "use server";

  const modelConfigurations = input.modelConfigurations.map((configuration) => ({
    apiKey: configuration.apiKey,
    baseUrl: configuration.baseUrl,
    contextSizeK: configuration.contextSizeK,
    id: configuration.id,
    model: configuration.model,
    provider: configuration.provider,
    providerOptions: configuration.providerOptions,
  }));

  await createSettingsService().updateSettings({
    defaultModelId: modelConfigurations[0]?.id ?? null,
    interfaceLanguage: input.interfaceLanguage,
    modelConfigurations,
  });

  const result = await createProjectService().createProject({
    name: "helloworld",
  });

  revalidatePath("/");

  return {
    href: buildWorkspaceHref(result.project.id, result.conversation.id),
  };
}
