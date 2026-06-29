'use client';

import { startTransition, useDeferredValue, useId, useMemo, useState, type FormEvent } from 'react';
import { useAppNavigate } from '@/lib/router';
import { ChevronDownIcon, MessageSquareIcon, PlusIcon } from 'lucide-react';

import type { ConversationRecord, ProjectRecord } from '@owndesign/core/workspace-store';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useI18n } from '@/features/i18n/context';
import { EntityMenu } from '@/features/projects/components/entity-menu';
import { filterByQuery } from '@/features/projects/utils';

type ControlBarProps = {
  activeConversationId?: string;
  activeProjectId?: string;
  conversations: ConversationRecord[];
  onCreateConversation: () => Promise<ControlBarActionResult> | ControlBarActionResult;
  onCreateProject: (
    name: string,
    description?: string,
    designDocument?: string | null,
  ) => Promise<ControlBarActionResult> | ControlBarActionResult;
  onDeleteConversation: (
    conversationId: string,
  ) => Promise<ControlBarActionResult> | ControlBarActionResult;
  onDeleteProject: (projectId: string) => Promise<ControlBarActionResult> | ControlBarActionResult;
  onRenameConversation: (
    conversationId: string,
    title: string,
  ) => Promise<ControlBarActionResult> | ControlBarActionResult;
  onRenameProject: (
    projectId: string,
    name: string,
    description?: string,
    designDocument?: string | null,
  ) => Promise<ControlBarActionResult> | ControlBarActionResult;
  onSelectConversation: (
    conversationId: string,
  ) => Promise<ControlBarActionResult> | ControlBarActionResult;
  onSelectProject: (projectId: string) => Promise<ControlBarActionResult> | ControlBarActionResult;
  projects: ProjectRecord[];
};

type ControlBarActionResult = { href?: string } | undefined | void;

type RenameTarget =
  | { type: 'conversation'; conversation: ConversationRecord }
  | { type: 'project'; project: ProjectRecord }
  | null;

type DeleteTarget =
  | { type: 'conversation'; conversation: ConversationRecord }
  | { type: 'project'; project: ProjectRecord }
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
  const { t } = useI18n();
  const navigate = useAppNavigate();
  const [openMenu, setOpenMenu] = useState<'project' | 'conversation' | null>(null);
  const [isProjectCreateOpen, setIsProjectCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [optimisticProjectId, setOptimisticProjectId] = useState<string>();
  const [projectQuery, setProjectQuery] = useState('');
  const [conversationQuery, setConversationQuery] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectDesignDocument, setProjectDesignDocument] = useState<string | null>();
  const [renameName, setRenameName] = useState('');
  const [renameDescription, setRenameDescription] = useState('');
  const [renameDesignDocument, setRenameDesignDocument] = useState<string | null>();
  const projectNameId = useId();
  const projectDesignDocumentId = useId();
  const renameNameId = useId();
  const renameDescriptionId = useId();
  const renameDesignDocumentId = useId();
  const deferredProjectQuery = useDeferredValue(projectQuery);
  const deferredConversationQuery = useDeferredValue(conversationQuery);

  const activeProject = projects.find((project) => project.id === activeProjectId);
  const effectiveOptimisticProjectId =
    optimisticProjectId === activeProjectId ? undefined : optimisticProjectId;
  const optimisticProject = projects.find((project) => project.id === effectiveOptimisticProjectId);
  const displayedProject = optimisticProject ?? activeProject;
  const isProjectSwitchPending = Boolean(effectiveOptimisticProjectId);
  const activeConversation = isProjectSwitchPending
    ? undefined
    : conversations.find((conversation) => conversation.id === activeConversationId);
  const filteredProjects = useMemo(
    () => filterByQuery(projects, deferredProjectQuery, (project) => project.name),
    [deferredProjectQuery, projects],
  );
  const filteredConversations = useMemo(
    () =>
      filterByQuery(
        isProjectSwitchPending ? [] : conversations,
        deferredConversationQuery,
        (conversation) => conversation.title,
      ),
    [conversations, deferredConversationQuery, isProjectSwitchPending],
  );

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Popover
        open={openMenu === 'project'}
        onOpenChange={(open) => {
          setOpenMenu(open ? 'project' : null);
          if (!open) {
            setProjectQuery('');
          }
        }}
      >
        <PopoverTrigger
          render={
            <Button
              aria-label={t('projects.projectSwitcher', {
                name: displayedProject?.name ?? t('projects.noCurrentProject'),
              })}
              className="h-7 max-w-[220px] justify-start gap-1.5 px-2 text-xs"
              type="button"
              variant="ghost"
            />
          }
        >
          <span className="size-1.5 shrink-0 rounded-full bg-primary" />
          <span className="truncate text-foreground">
            {displayedProject?.name ?? t('projects.selectProject')}
          </span>
          <ChevronDownIcon data-icon="inline-end" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(360px,calc(100vw-2rem))] gap-0 overflow-hidden p-0"
          sideOffset={8}
        >
          <Command shouldFilter={false}>
            <div className="px-3 pt-3 pb-2">
              <CommandInput
                aria-label={t('projects.searchProjects')}
                className="border-0 bg-transparent px-0"
                onValueChange={setProjectQuery}
                placeholder={t('projects.searchProjectsPlaceholder')}
                value={projectQuery}
                wrapperClassName="w-full p-0"
              />
            </div>
            <CommandList>
              <CommandEmpty>{t('projects.noMatchingProjects')}</CommandEmpty>
              <CommandGroup>
                {filteredProjects.map((project) => (
                  <CommandItem
                    aria-label={project.name}
                    className={cn(
                      'group/item mb-1 gap-2 last:mb-0',
                      project.id === (effectiveOptimisticProjectId ?? activeProjectId) &&
                        'bg-primary/15 text-primary data-[selected=true]:bg-primary/15 data-[selected=true]:text-primary',
                    )}
                    key={project.id}
                    onSelect={() => {
                      setOpenMenu(null);
                      if (project.id !== activeProjectId) {
                        setOptimisticProjectId(project.id);
                      }
                      startTransition(() => {
                        void runAction(onSelectProject(project.id));
                      });
                    }}
                    showIndicator={false}
                    value={project.name}
                  >
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {project.updatedAt.slice(0, 10)}
                    </span>
                    <EntityMenu
                      onDelete={() => {
                        setOpenMenu(null);
                        setDeleteTarget({ type: 'project', project });
                      }}
                      onRename={() => {
                        setOpenMenu(null);
                        setRenameName(project.name);
                        setRenameDescription(project.description ?? '');
                        setRenameDesignDocument(project.designDocument);
                        setRenameTarget({ type: 'project', project });
                      }}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  className="mb-1 last:mb-0"
                  onSelect={() => {
                    setOpenMenu(null);
                    setIsProjectCreateOpen(true);
                  }}
                  showIndicator={false}
                  value={t('projects.newProject')}
                >
                  <PlusIcon data-icon="inline-start" />
                  {t('projects.newProject')}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Popover
        open={openMenu === 'conversation'}
        onOpenChange={(open) => {
          setOpenMenu(open ? 'conversation' : null);
          if (!open) {
            setConversationQuery('');
          }
        }}
      >
        <PopoverTrigger
          render={
            <Button
              aria-label={t('projects.conversationSwitcher', {
                name: isProjectSwitchPending
                  ? t('projects.loadingConversations')
                  : (activeConversation?.title ?? t('projects.noCurrentConversation')),
              })}
              className="h-7 max-w-[220px] justify-start gap-1.5 px-2 text-xs"
              disabled={!activeProject || isProjectSwitchPending}
              type="button"
              variant="ghost"
            />
          }
        >
          <span className="size-1.5 shrink-0 rounded-full bg-[var(--status-ready)]" />
          <span className="truncate text-foreground">
            {isProjectSwitchPending
              ? t('projects.loadingConversations')
              : (activeConversation?.title ?? t('projects.selectConversation'))}
          </span>
          <ChevronDownIcon data-icon="inline-end" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(360px,calc(100vw-2rem))] gap-0 overflow-hidden p-0"
          sideOffset={8}
        >
          <Command shouldFilter={false}>
            <div className="px-3 pt-3 pb-2">
              <CommandInput
                aria-label={t('projects.searchConversations')}
                className="border-0 bg-transparent px-0"
                onValueChange={setConversationQuery}
                placeholder={t('projects.searchConversationsPlaceholder')}
                value={conversationQuery}
                wrapperClassName="w-full p-0"
              />
            </div>
            <CommandList>
              <CommandEmpty>{t('projects.noMatchingConversations')}</CommandEmpty>
              <CommandGroup>
                {filteredConversations.map((conversation) => (
                  <CommandItem
                    aria-label={conversation.title}
                    className={cn(
                      'group/item mb-1 gap-2 last:mb-0',
                      conversation.id === activeConversationId &&
                        'bg-primary/15 text-primary [&_[data-icon=inline-start]]:text-primary data-[selected=true]:bg-primary/15 data-[selected=true]:text-primary data-[selected=true]:[&_[data-icon=inline-start]]:text-primary',
                    )}
                    key={conversation.id}
                    onSelect={() => {
                      setOpenMenu(null);
                      startTransition(() => {
                        void runAction(onSelectConversation(conversation.id));
                      });
                    }}
                    showIndicator={false}
                    value={conversation.title}
                  >
                    <MessageSquareIcon data-icon="inline-start" />
                    <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
                    <EntityMenu
                      onDelete={() => {
                        setOpenMenu(null);
                        setDeleteTarget({ type: 'conversation', conversation });
                      }}
                      onRename={() => {
                        setOpenMenu(null);
                        setRenameName(conversation.title);
                        setRenameDescription('');
                        setRenameTarget({ type: 'conversation', conversation });
                      }}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  className="mb-1 last:mb-0"
                  disabled={!activeProject || isProjectSwitchPending}
                  onSelect={() => {
                    setOpenMenu(null);
                    startTransition(() => {
                      void runAction(onCreateConversation());
                    });
                  }}
                  showIndicator={false}
                  value={t('projects.newConversation')}
                >
                  <PlusIcon data-icon="inline-start" />
                  {t('projects.newConversation')}
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
            setProjectName('');
            setProjectDesignDocument(undefined);
          }
        }}
        open={isProjectCreateOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('projects.createTitle')}</DialogTitle>
            <DialogDescription>{t('projects.createDescription')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleProjectCreate}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={projectNameId}>{t('projects.projectName')}</FieldLabel>
                <Input
                  id={projectNameId}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder={t('projects.projectNamePlaceholder')}
                  required
                  value={projectName}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={projectDesignDocumentId}>
                  {t('projects.designDocument')}
                </FieldLabel>
                <Input
                  accept=".md,text/markdown,text/plain"
                  id={projectDesignDocumentId}
                  onChange={(event) => {
                    void readDesignDocumentFile(event.currentTarget.files?.[0]).then(
                      setProjectDesignDocument,
                    );
                  }}
                  type="file"
                />
                {projectDesignDocument ? (
                  <div className="text-xs text-muted-foreground">
                    {t('projects.designDocumentAttached')}
                  </div>
                ) : null}
              </Field>
            </FieldGroup>
            <DialogFooter className="mt-5 border-t-0">
              <Button type="submit">{t('projects.create')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null);
            setRenameName('');
            setRenameDescription('');
            setRenameDesignDocument(undefined);
          }
        }}
        open={renameTarget !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {renameTarget?.type === 'project'
                ? t('projects.renameProject')
                : t('projects.renameConversation')}
            </DialogTitle>
            <DialogDescription>{t('projects.renameDescription')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRename}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={renameNameId}>{t('projects.newName')}</FieldLabel>
                <Input
                  id={renameNameId}
                  onChange={(event) => setRenameName(event.target.value)}
                  required
                  value={renameName}
                />
              </Field>
              {renameTarget?.type === 'project' ? (
                <>
                  <Field>
                    <FieldLabel htmlFor={renameDescriptionId}>
                      {t('projects.projectDescription')}
                    </FieldLabel>
                    <Textarea
                      id={renameDescriptionId}
                      onChange={(event) => setRenameDescription(event.target.value)}
                      value={renameDescription}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={renameDesignDocumentId}>
                      {t('projects.designDocument')}
                    </FieldLabel>
                    <Input
                      accept=".md,text/markdown,text/plain"
                      id={renameDesignDocumentId}
                      onChange={(event) => {
                        void readDesignDocumentFile(event.currentTarget.files?.[0]).then(
                          setRenameDesignDocument,
                        );
                      }}
                      type="file"
                    />
                    {renameDesignDocument ? (
                      <div className="text-xs text-muted-foreground">
                        {t('projects.designDocumentAttached')}
                      </div>
                    ) : null}
                    {renameDesignDocument !== undefined ? (
                      <Button
                        onClick={() => setRenameDesignDocument(null)}
                        type="button"
                        variant="outline"
                      >
                        {t('projects.removeDesignDocument')}
                      </Button>
                    ) : null}
                  </Field>
                </>
              ) : null}
            </FieldGroup>
            <DialogFooter className="mt-5">
              <Button type="submit">{t('common.save')}</Button>
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
            <AlertDialogTitle>{t('projects.confirmDelete')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('projects.deleteDescription')}
              {deleteTarget
                ? ` ${
                    deleteTarget.type === 'project'
                      ? t('projects.deleteProjectName', {
                          name: deleteTarget.project.name,
                        })
                      : t('projects.deleteConversationName', {
                          name: deleteTarget.conversation.title,
                        })
                  }`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!deleteTarget) {
                  return;
                }

                const target = deleteTarget;
                setDeleteTarget(null);
                startTransition(() => {
                  if (target.type === 'project') {
                    void runAction(onDeleteProject(target.project.id));
                  } else {
                    void runAction(onDeleteConversation(target.conversation.id));
                  }
                });
              }}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  function handleProjectCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = projectName.trim();

    if (!trimmedName) {
      return;
    }

    setIsProjectCreateOpen(false);
    setProjectName('');
    setProjectDesignDocument(undefined);
    startTransition(() => {
      void runAction(onCreateProject(trimmedName, undefined, projectDesignDocument));
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
    setRenameName('');
    setRenameDescription('');
    setRenameDesignDocument(undefined);
    startTransition(() => {
      if (target.type === 'project') {
        void runAction(
          onRenameProject(
            target.project.id,
            trimmedName,
            trimmedDescription || undefined,
            renameDesignDocument,
          ),
        );
      } else {
        void runAction(onRenameConversation(target.conversation.id, trimmedName));
      }
    });
  }

  async function runAction(actionResult: Promise<ControlBarActionResult> | ControlBarActionResult) {
    const result = await actionResult;

    if (result?.href) {
      navigate(result.href);
      return;
    }

    window.dispatchEvent(new Event('owndesign:workspace-refresh'));
  }
}

async function readDesignDocumentFile(file: File | undefined) {
  if (!file) {
    return undefined;
  }

  return file.text();
}
