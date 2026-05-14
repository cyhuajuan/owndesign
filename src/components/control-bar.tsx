"use client";

import {
  startTransition,
  useDeferredValue,
  useId,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import type {
  ConversationRecord,
  ProjectRecord,
} from "@/lib/workspace-store";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  FolderIcon,
  MessageSquareIcon,
  PlusIcon,
} from "lucide-react";

type ControlBarProps = {
  activeConversationId?: string;
  activeProjectId?: string;
  conversations: ConversationRecord[];
  onCreateConversation: () => Promise<void> | void;
  onCreateProject: (
    name: string,
    description?: string,
  ) => Promise<void> | void;
  onSelectConversation: (conversationId: string) => Promise<void> | void;
  onSelectProject: (projectId: string) => Promise<void> | void;
  projects: ProjectRecord[];
};

export function ControlBar({
  activeConversationId,
  activeProjectId,
  conversations,
  onCreateConversation,
  onCreateProject,
  onSelectConversation,
  onSelectProject,
  projects,
}: ControlBarProps) {
  const [openMenu, setOpenMenu] = useState<"project" | "conversation" | null>(
    null,
  );
  const [isProjectCreateOpen, setIsProjectCreateOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [conversationQuery, setConversationQuery] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const projectNameId = useId();
  const projectDescriptionId = useId();
  const deferredProjectQuery = useDeferredValue(projectQuery);
  const deferredConversationQuery = useDeferredValue(conversationQuery);

  const activeProject = projects.find((project) => project.id === activeProjectId);
  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId,
  );
  const filteredProjects = useMemo(
    () => filterByQuery(projects, deferredProjectQuery, (project) => project.name),
    [deferredProjectQuery, projects],
  );
  const filteredConversations = useMemo(
    () =>
      filterByQuery(
        conversations,
        deferredConversationQuery,
        (conversation) => conversation.title,
      ),
    [conversations, deferredConversationQuery],
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        aria-label={`项目切换器 ${activeProject?.name ?? "暂无当前项目"}`}
        onClick={() => setOpenMenu("project")}
        size="sm"
        type="button"
        variant="outline"
      >
        <FolderIcon data-icon="inline-start" />
        {activeProject?.name ?? "选择项目"}
      </Button>

      <Button
        aria-label={`会话切换器 ${activeConversation?.title ?? "暂无当前会话"}`}
        disabled={!activeProject}
        onClick={() => setOpenMenu("conversation")}
        size="sm"
        type="button"
        variant="outline"
      >
        <MessageSquareIcon data-icon="inline-start" />
        {activeConversation?.title ?? "选择会话"}
      </Button>

      <CommandDialog
        description="搜索或创建项目。"
        onOpenChange={(open) => {
          setOpenMenu(open ? "project" : null);
          if (!open) {
            setProjectQuery("");
          }
        }}
        open={openMenu === "project"}
        title="项目切换器"
      >
        <Command shouldFilter={false}>
          <CommandInput
            aria-label="搜索项目"
            onValueChange={setProjectQuery}
            placeholder="搜索项目..."
            value={projectQuery}
          />
          <CommandList>
            <CommandEmpty>没有匹配的项目。</CommandEmpty>
            <CommandGroup heading="项目">
              {filteredProjects.map((project) => (
                <CommandItem
                  key={project.id}
                  onSelect={() => {
                    setOpenMenu(null);
                    startTransition(() => {
                      void onSelectProject(project.id);
                    });
                  }}
                  value={project.name}
                >
                  {project.name}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="操作">
              <CommandItem
                onSelect={() => {
                  setOpenMenu(null);
                  setIsProjectCreateOpen(true);
                }}
                value="new-project"
              >
                <PlusIcon data-icon="inline-start" />
                新建项目
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>

      <Dialog
        onOpenChange={(open) => {
          setIsProjectCreateOpen(open);
          if (!open) {
            setProjectName("");
            setProjectDescription("");
          }
        }}
        open={isProjectCreateOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建项目</DialogTitle>
            <DialogDescription>
              无需离开控制栏即可开始一个新项目。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleProjectCreate}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={projectNameId}>项目名称</FieldLabel>
                <Input
                  id={projectNameId}
                  onChange={(event) => setProjectName(event.target.value)}
                  required
                  value={projectName}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={projectDescriptionId}>
                  项目描述
                </FieldLabel>
                <Textarea
                  className="min-h-24"
                  id={projectDescriptionId}
                  onChange={(event) => setProjectDescription(event.target.value)}
                  value={projectDescription}
                />
              </Field>
            </FieldGroup>
            <DialogFooter className="mt-4">
              <Button type="submit">
                <PlusIcon data-icon="inline-start" />
                创建项目
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <CommandDialog
        description="搜索或创建会话。"
        onOpenChange={(open) => {
          setOpenMenu(open ? "conversation" : null);
          if (!open) {
            setConversationQuery("");
          }
        }}
        open={openMenu === "conversation"}
        title="会话切换器"
      >
        <Command shouldFilter={false}>
          <CommandInput
            aria-label="搜索会话"
            onValueChange={setConversationQuery}
            placeholder="搜索会话..."
            value={conversationQuery}
          />
          <CommandList>
            <CommandEmpty>没有匹配的会话。</CommandEmpty>
            <CommandGroup heading="会话">
              {filteredConversations.map((conversation) => (
                <CommandItem
                  key={conversation.id}
                  onSelect={() => {
                    setOpenMenu(null);
                    startTransition(() => {
                      void onSelectConversation(conversation.id);
                    });
                  }}
                  value={conversation.title}
                >
                  {conversation.title}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="操作">
              <CommandItem
                onSelect={() => {
                  setOpenMenu(null);
                  startTransition(() => {
                    void onCreateConversation();
                  });
                }}
                value="new-conversation"
              >
                <PlusIcon data-icon="inline-start" />
                新建会话
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </div>
  );

  function handleProjectCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = projectName.trim();
    const trimmedDescription = projectDescription.trim();

    if (!trimmedName) {
      return;
    }

    setIsProjectCreateOpen(false);
    setProjectName("");
    setProjectDescription("");
    startTransition(() => {
      void onCreateProject(trimmedName, trimmedDescription || undefined);
    });
  }
}

function filterByQuery<T>(
  items: T[],
  query: string,
  getLabel: (item: T) => string,
) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return items;
  }

  return items.filter((item) =>
    getLabel(item).toLowerCase().includes(normalizedQuery),
  );
}
