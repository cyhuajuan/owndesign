"use client";

import {
  startTransition,
  useDeferredValue,
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
        aria-label={`Project switcher ${activeProject?.name ?? "No active Project"}`}
        onClick={() => setOpenMenu("project")}
        size="sm"
        type="button"
        variant="outline"
      >
        {activeProject?.name ?? "Select Project"}
      </Button>

      <Button
        aria-label={`Conversation switcher ${activeConversation?.title ?? "No active Conversation"}`}
        disabled={!activeProject}
        onClick={() => setOpenMenu("conversation")}
        size="sm"
        type="button"
        variant="outline"
      >
        {activeConversation?.title ?? "Select Conversation"}
      </Button>

      <CommandDialog
        description="Search or create a Project."
        onOpenChange={(open) => {
          setOpenMenu(open ? "project" : null);
          if (!open) {
            setProjectQuery("");
          }
        }}
        open={openMenu === "project"}
        title="Project switcher"
      >
        <Command shouldFilter={false}>
          <CommandInput
            aria-label="Search projects"
            onValueChange={setProjectQuery}
            placeholder="Search projects..."
            value={projectQuery}
          />
          <CommandList>
            <CommandEmpty>No Projects match.</CommandEmpty>
            <CommandGroup heading="Projects">
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
            <CommandGroup heading="Actions">
              <CommandItem
                onSelect={() => {
                  setOpenMenu(null);
                  setIsProjectCreateOpen(true);
                }}
                value="new-project"
              >
                New Project
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
            <DialogTitle>Create Project</DialogTitle>
            <DialogDescription>
              Start a new Project without leaving Control Bar.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={handleProjectCreate}>
            <label className="grid gap-1 text-sm font-medium">
              <span>Project name</span>
              <input
                className="rounded-xl border border-input bg-background px-3 py-2 text-sm"
                onChange={(event) => setProjectName(event.target.value)}
                required
                value={projectName}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              <span>Project description</span>
              <textarea
                className="min-h-24 rounded-xl border border-input bg-background px-3 py-2 text-sm"
                onChange={(event) => setProjectDescription(event.target.value)}
                value={projectDescription}
              />
            </label>
            <DialogFooter>
              <Button type="submit">Create Project</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <CommandDialog
        description="Search or create a Conversation."
        onOpenChange={(open) => {
          setOpenMenu(open ? "conversation" : null);
          if (!open) {
            setConversationQuery("");
          }
        }}
        open={openMenu === "conversation"}
        title="Conversation switcher"
      >
        <Command shouldFilter={false}>
          <CommandInput
            aria-label="Search conversations"
            onValueChange={setConversationQuery}
            placeholder="Search conversations..."
            value={conversationQuery}
          />
          <CommandList>
            <CommandEmpty>No Conversations match.</CommandEmpty>
            <CommandGroup heading="Conversations">
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
            <CommandGroup heading="Actions">
              <CommandItem
                onSelect={() => {
                  setOpenMenu(null);
                  startTransition(() => {
                    void onCreateConversation();
                  });
                }}
                value="new-conversation"
              >
                New Conversation
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
