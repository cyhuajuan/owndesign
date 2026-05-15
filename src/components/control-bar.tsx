"use client";

import {
  startTransition,
  useDeferredValue,
  useId,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDownIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";

import type {
  ConversationRecord,
  ProjectRecord,
} from "@/lib/workspace-store";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Command,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ControlBarProps = {
  activeConversationId?: string;
  activeProjectId?: string;
  conversations: ConversationRecord[];
  onCreateConversation: () => Promise<ControlBarActionResult> | ControlBarActionResult;
  onCreateProject: (
    name: string,
    description?: string,
  ) => Promise<ControlBarActionResult> | ControlBarActionResult;
  onDeleteConversation: (
    conversationId: string,
  ) => Promise<ControlBarActionResult> | ControlBarActionResult;
  onDeleteProject: (
    projectId: string,
  ) => Promise<ControlBarActionResult> | ControlBarActionResult;
  onRenameConversation: (
    conversationId: string,
    title: string,
  ) => Promise<ControlBarActionResult> | ControlBarActionResult;
  onRenameProject: (
    projectId: string,
    name: string,
    description?: string,
  ) => Promise<ControlBarActionResult> | ControlBarActionResult;
  onSelectConversation: (
    conversationId: string,
  ) => Promise<ControlBarActionResult> | ControlBarActionResult;
  onSelectProject: (
    projectId: string,
  ) => Promise<ControlBarActionResult> | ControlBarActionResult;
  projects: ProjectRecord[];
};

type ControlBarActionResult = { href?: string } | undefined | void;

type RenameTarget =
  | { type: "conversation"; conversation: ConversationRecord }
  | { type: "project"; project: ProjectRecord }
  | null;

type DeleteTarget =
  | { type: "conversation"; conversation: ConversationRecord }
  | { type: "project"; project: ProjectRecord }
  | null;

export function ControlBar({
  activeConversationId,
  activeProjectId,
  conversations,
  onCreateConversation,
  onCreateProject,
  onDeleteConversation,
  onDeleteProject,
  onRenameConversation,
  onRenameProject,
  onSelectConversation,
  onSelectProject,
  projects,
}: ControlBarProps) {
  const router = useRouter();
  const [openMenu, setOpenMenu] = useState<"project" | "conversation" | null>(
    null,
  );
  const [isProjectCreateOpen, setIsProjectCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [projectQuery, setProjectQuery] = useState("");
  const [conversationQuery, setConversationQuery] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [renameName, setRenameName] = useState("");
  const [renameDescription, setRenameDescription] = useState("");
  const projectNameId = useId();
  const projectDescriptionId = useId();
  const renameNameId = useId();
  const renameDescriptionId = useId();
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
    <div className="flex min-w-0 items-center gap-1.5">
      <Popover
        open={openMenu === "project"}
        onOpenChange={(open) => {
          setOpenMenu(open ? "project" : null);
          if (!open) {
            setProjectQuery("");
          }
        }}
      >
        <PopoverTrigger
          render={
            <Button
              aria-label={`项目切换器 ${activeProject?.name ?? "暂无当前项目"}`}
              className="h-7 max-w-[220px] justify-start gap-1.5 px-2 text-xs"
              type="button"
              variant="ghost"
            />
          }
        >
          <span className="size-1.5 shrink-0 rounded-full bg-primary" />
          <span className="truncate text-foreground">
            {activeProject?.name ?? "选择项目"}
          </span>
          <ChevronDownIcon data-icon="inline-end" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(360px,calc(100vw-2rem))] gap-0 overflow-hidden p-0"
          sideOffset={8}
        >
          <Command shouldFilter={false}>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <SearchIcon className="size-3.5 text-muted-foreground" />
              <CommandInput
                aria-label="搜索项目"
                className="border-0 bg-transparent px-0"
                onValueChange={setProjectQuery}
                placeholder="搜索项目..."
                value={projectQuery}
              />
            </div>
            <CommandList>
              <CommandEmpty>没有匹配的项目。</CommandEmpty>
              <CommandGroup>
                {filteredProjects.map((project) => (
                  <CommandItem
                    aria-label={project.name}
                    className={cn(
                      "group/item gap-2",
                      project.id === activeProjectId &&
                        "bg-primary/15 text-primary",
                    )}
                    key={project.id}
                    onSelect={() => {
                      setOpenMenu(null);
                      startTransition(() => {
                        void runAction(onSelectProject(project.id));
                      });
                    }}
                    value={project.name}
                  >
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {project.updatedAt.slice(0, 10)}
                    </span>
                    <EntityMenu
                      onDelete={() => {
                        setOpenMenu(null);
                        setDeleteTarget({ type: "project", project });
                      }}
                      onRename={() => {
                        setOpenMenu(null);
                        setRenameName(project.name);
                        setRenameDescription(project.description ?? "");
                        setRenameTarget({ type: "project", project });
                      }}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  onSelect={() => {
                    setOpenMenu(null);
                    setIsProjectCreateOpen(true);
                  }}
                  value="新建项目"
                >
                  <PlusIcon data-icon="inline-start" />
                  新建项目
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Popover
        open={openMenu === "conversation"}
        onOpenChange={(open) => {
          setOpenMenu(open ? "conversation" : null);
          if (!open) {
            setConversationQuery("");
          }
        }}
      >
        <PopoverTrigger
          render={
            <Button
              aria-label={`会话切换器 ${activeConversation?.title ?? "暂无当前会话"}`}
              className="h-7 max-w-[220px] justify-start gap-1.5 px-2 text-xs"
              disabled={!activeProject}
              type="button"
              variant="ghost"
            />
          }
        >
          <span className="size-1.5 shrink-0 rounded-full bg-[var(--status-ready)]" />
          <span className="truncate text-foreground">
            {activeConversation?.title ?? "选择会话"}
          </span>
          <ChevronDownIcon data-icon="inline-end" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(360px,calc(100vw-2rem))] gap-0 overflow-hidden p-0"
          sideOffset={8}
        >
          <Command shouldFilter={false}>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <SearchIcon className="size-3.5 text-muted-foreground" />
              <CommandInput
                aria-label="搜索会话"
                className="border-0 bg-transparent px-0"
                onValueChange={setConversationQuery}
                placeholder="搜索会话..."
                value={conversationQuery}
              />
            </div>
            <CommandList>
              <CommandEmpty>没有匹配的会话。</CommandEmpty>
              <CommandGroup>
                {filteredConversations.map((conversation) => (
                  <CommandItem
                    aria-label={conversation.title}
                    className={cn(
                      "group/item gap-2",
                      conversation.id === activeConversationId &&
                        "bg-primary/15 text-primary",
                    )}
                    key={conversation.id}
                    onSelect={() => {
                      setOpenMenu(null);
                      startTransition(() => {
                        void runAction(onSelectConversation(conversation.id));
                      });
                    }}
                    value={conversation.title}
                  >
                    <MessageSquareIcon data-icon="inline-start" />
                    <span className="min-w-0 flex-1 truncate">
                      {conversation.title}
                    </span>
                    <EntityMenu
                      onDelete={() => {
                        setOpenMenu(null);
                        setDeleteTarget({ type: "conversation", conversation });
                      }}
                      onRename={() => {
                        setOpenMenu(null);
                        setRenameName(conversation.title);
                        setRenameDescription("");
                        setRenameTarget({ type: "conversation", conversation });
                      }}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  disabled={!activeProject}
                  onSelect={() => {
                    setOpenMenu(null);
                    startTransition(() => {
                      void runAction(onCreateConversation());
                    });
                  }}
                  value="新建会话"
                >
                  <PlusIcon data-icon="inline-start" />
                  新建会话
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

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
            <DialogTitle>新建项目</DialogTitle>
            <DialogDescription>
              创建后会自动进入新项目的第一段会话。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleProjectCreate}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={projectNameId}>项目名称</FieldLabel>
                <Input
                  id={projectNameId}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder="输入项目名称"
                  required
                  value={projectName}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={projectDescriptionId}>
                  项目描述
                </FieldLabel>
                <Textarea
                  id={projectDescriptionId}
                  onChange={(event) => setProjectDescription(event.target.value)}
                  placeholder="可选描述"
                  value={projectDescription}
                />
              </Field>
            </FieldGroup>
            <DialogFooter className="mt-5">
              <Button type="submit">创建项目</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null);
            setRenameName("");
            setRenameDescription("");
          }
        }}
        open={renameTarget !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {renameTarget?.type === "project" ? "重命名项目" : "重命名会话"}
            </DialogTitle>
            <DialogDescription>
              更新顶栏和列表中展示的名称。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRename}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={renameNameId}>新名称</FieldLabel>
                <Input
                  id={renameNameId}
                  onChange={(event) => setRenameName(event.target.value)}
                  required
                  value={renameName}
                />
              </Field>
              {renameTarget?.type === "project" ? (
                <Field>
                  <FieldLabel htmlFor={renameDescriptionId}>
                    项目描述
                  </FieldLabel>
                  <Textarea
                    id={renameDescriptionId}
                    onChange={(event) =>
                      setRenameDescription(event.target.value)
                    }
                    value={renameDescription}
                  />
                </Field>
              ) : null}
            </FieldGroup>
            <DialogFooter className="mt-5">
              <Button type="submit">保存</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        open={deleteTarget !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              将移入系统回收站，而非永久删除。
              {deleteTarget ? ` ${getDeleteName(deleteTarget)}` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!deleteTarget) {
                  return;
                }

                const target = deleteTarget;
                setDeleteTarget(null);
                startTransition(() => {
                  if (target.type === "project") {
                    void runAction(onDeleteProject(target.project.id));
                  } else {
                    void runAction(onDeleteConversation(target.conversation.id));
                  }
                });
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
      void runAction(
        onCreateProject(trimmedName, trimmedDescription || undefined),
      );
    });
  }

  function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!renameTarget) {
      return;
    }

    const trimmedName = renameName.trim();
    const trimmedDescription = renameDescription.trim();

    if (!trimmedName) {
      return;
    }

    const target = renameTarget;
    setRenameTarget(null);
    setRenameName("");
    setRenameDescription("");
    startTransition(() => {
      if (target.type === "project") {
        void runAction(
          onRenameProject(
            target.project.id,
            trimmedName,
            trimmedDescription || undefined,
          ),
        );
      } else {
        void runAction(
          onRenameConversation(target.conversation.id, trimmedName),
        );
      }
    });
  }

  async function runAction(
    actionResult: Promise<ControlBarActionResult> | ControlBarActionResult,
  ) {
    const result = await actionResult;

    if (result?.href) {
      router.push(result.href);
      router.refresh();
      return;
    }

    router.refresh();
  }
}

function EntityMenu({
  onDelete,
  onRename,
}: {
  onDelete: () => void;
  onRename: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/item:opacity-100">
      <Button
        aria-label="重命名"
        onClick={(event) => {
          event.stopPropagation();
          onRename();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <PencilIcon />
      </Button>
      <Button
        aria-label="删除"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}

function getDeleteName(target: NonNullable<DeleteTarget>) {
  return target.type === "project"
    ? `项目“${target.project.name}”会被删除。`
    : `会话“${target.conversation.title}”会被删除。`;
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
