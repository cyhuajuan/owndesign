'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useAppNavigate } from '@/lib/router';
import {
  DownloadIcon,
  ExternalLinkIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  RefreshCwIcon,
} from 'lucide-react';

import { AppBrand } from '@/components/app-brand';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SettingsControl } from '@/features/settings/components/settings-control';
import { useI18n } from '@/features/i18n/context';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FrontendCapabilityBridge } from '@/features/preview/components/frontend-capability-bridge';
import type { PreviewDevice } from '@/features/preview/preview-device';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarInset,
  SidebarProvider,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { useApiClient } from '@/api/context';

const CONVERSATION_PANE_STORAGE_KEY = 'owndesign.app.conversation-pane-collapsed';
const CONVERSATION_PANE_EVENT = 'owndesign:conversation-pane';
const PREVIEW_REFRESH_EVENT = 'owndesign:preview-refresh';
const PREVIEW_HREF_EVENT = 'owndesign:preview-href-updated';
const PREVIEW_FILES_EVENT = 'owndesign:preview-files-updated';
const PREVIEW_MANUAL_SWITCH_EVENT = 'owndesign:preview-manual-switch';

type PreviewStatus = 'ready' | 'loading' | 'error';

type PreviewBodyContext = {
  previewDevice: PreviewDevice;
};

export type ChatShellSlots = {
  topBarDragRegion?: ReactNode;
  topBarTrailing?: ReactNode;
};

type ChatShellProps = {
  composer?: ReactNode;
  conversationBody?: ReactNode;
  controlBar?: ReactNode;
  messageHistory?: ReactNode;
  previewActions?: ReactNode;
  previewBody?: ReactNode | ((context: PreviewBodyContext) => ReactNode);
  previewFilename?: ReactNode;
  previewHref?: string;
  previewProjectId?: string;
  previewStatus?: PreviewStatus;
  shellSlots?: ChatShellSlots;
};

export function ChatShell({
  composer,
  conversationBody,
  controlBar,
  messageHistory,
  previewActions,
  previewBody,
  previewFilename,
  previewHref,
  previewProjectId,
  previewStatus = 'ready',
  shellSlots,
}: ChatShellProps) {
  const api = useApiClient();
  const { t } = useI18n();
  const navigate = useAppNavigate();
  const [sessionPreviewHref, setSessionPreviewHref] = useState<string>();
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>('desktop');
  const [previewFiles, setPreviewFiles] = useState<string[]>([]);
  const [activePreviewPath, setActivePreviewPath] = useState<string>();
  const isConversationCollapsed = useSyncExternalStore(
    subscribeToConversationPaneState,
    readConversationPaneState,
    () => false,
  );
  const isSidebarOpen = !isConversationCollapsed;
  const effectivePreviewHref = previewHref ?? sessionPreviewHref;
  const statusClassName = useMemo(
    () =>
      cn(
        'size-1.5 rounded-full',
        previewStatus === 'ready' && 'bg-[var(--status-ready)]',
        previewStatus === 'loading' && 'animate-pulse bg-[var(--status-warning)]',
        previewStatus === 'error' && 'bg-destructive',
      ),
    [previewStatus],
  );

  useEffect(() => {
    const handlePreviewHrefUpdated = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return;
      }

      setSessionPreviewHref(typeof event.detail?.href === 'string' ? event.detail.href : undefined);
    };

    window.addEventListener(PREVIEW_HREF_EVENT, handlePreviewHrefUpdated);

    return () => {
      window.removeEventListener(PREVIEW_HREF_EVENT, handlePreviewHrefUpdated);
    };
  }, []);

  useEffect(() => {
    const handlePreviewFilesUpdated = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return;
      }

      const files = Array.isArray(event.detail?.files)
        ? event.detail.files.filter((file: unknown): file is string => typeof file === 'string')
        : [];
      const activePath =
        typeof event.detail?.activePath === 'string' ? event.detail.activePath : undefined;

      setPreviewFiles(files);
      setActivePreviewPath(activePath);
    };

    window.addEventListener(PREVIEW_FILES_EVENT, handlePreviewFilesUpdated);

    return () => {
      window.removeEventListener(PREVIEW_FILES_EVENT, handlePreviewFilesUpdated);
    };
  }, []);

  const selectPreviewPath = (nextPath: string) => {
    if (nextPath === activePreviewPath) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    params.set('previewPath', nextPath);
    window.dispatchEvent(
      new CustomEvent(PREVIEW_MANUAL_SWITCH_EVENT, {
        detail: { key: String(Date.now()) },
      }),
    );
    navigate(`${window.location.pathname}?${params.toString()}`, {
      preventScrollReset: true,
      replace: true,
    });
  };
  const previewFilenameNode = previewFilename ?? (
    <PreviewFileSelect
      activePath={activePreviewPath}
      files={previewFiles}
      onChange={selectPreviewPath}
    />
  );
  const currentHtmlDownloadUrl =
    previewProjectId && activePreviewPath
      ? api.buildUrl(buildProjectDownloadPath(previewProjectId, 'current-html', activePreviewPath))
      : undefined;
  const workspaceZipDownloadUrl = previewProjectId
    ? api.buildUrl(buildProjectDownloadPath(previewProjectId, 'workspace-zip'))
    : undefined;
  const statusLabels: Record<PreviewStatus, string> = {
    error: t('shell.error'),
    loading: t('app.loading'),
    ready: t('shell.ready'),
  };
  const demoMessages = [
    {
      content: t('shell.demoUser'),
      role: 'user' as const,
    },
    {
      content: t('shell.demoAssistant'),
      role: 'assistant' as const,
    },
  ];
  const previewBodyNode =
    typeof previewBody === 'function' ? previewBody({ previewDevice }) : previewBody;

  return (
    <SidebarProvider
      className="h-screen min-h-0 bg-background text-foreground"
      open={isSidebarOpen}
      onOpenChange={(open) => writeConversationPaneState(!open)}
      style={
        {
          '--sidebar-width': '400px',
          '--sidebar-width-icon': '0px',
        } as CSSProperties
      }
    >
      <FrontendCapabilityBridge projectId={previewProjectId} />
      <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
        <header
          className={cn(
            'flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card py-0 pl-3',
            shellSlots?.topBarTrailing ? 'pr-0' : 'pr-3',
          )}
        >
          <AppBrand />
          <Separator orientation="vertical" className="h-5" />
          {controlBar ? (
            <div key="control-bar" className="min-w-0">
              {controlBar}
            </div>
          ) : null}
          {shellSlots?.topBarDragRegion ?? <div className="flex-1" />}
          <SettingsControl />
          {shellSlots?.topBarTrailing}
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar
            aria-label={t('shell.conversationWorkflow')}
            className="top-11 h-[calc(100vh-2.75rem)] border-r border-border bg-card"
            collapsible="offcanvas"
            role="region"
          >
            <SidebarContent className="bg-card">
              {conversationBody ?? (
                <Conversation className="min-h-0">
                  <ConversationContent className="gap-2 p-4">
                    {messageHistory ??
                      (demoMessages.length === 0 ? (
                        <ConversationEmptyState />
                      ) : (
                        demoMessages.map((message, index) => (
                          <Message from={message.role} key={`${message.role}-${index}`}>
                            <MessageContent>{message.content}</MessageContent>
                          </Message>
                        ))
                      ))}
                  </ConversationContent>
                </Conversation>
              )}
            </SidebarContent>
            {conversationBody ? null : (
              <SidebarFooter className="border-t border-border bg-card p-3">
                {composer ?? (
                  <PromptInput onSubmit={() => {}}>
                    <PromptInputBody>
                      <PromptInputTextarea placeholder={t('conversation.placeholder')} />
                    </PromptInputBody>
                    <PromptInputFooter>
                      <PromptInputTools />
                      <PromptInputSubmit />
                    </PromptInputFooter>
                  </PromptInput>
                )}
              </SidebarFooter>
            )}
          </Sidebar>

          <SidebarInset
            aria-label={t('preview.panel')}
            className="min-w-0 bg-background"
            role="region"
          >
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex h-[38px] shrink-0 items-center gap-2 border-b border-border bg-card px-3">
                <Button
                  aria-label={
                    isConversationCollapsed
                      ? t('shell.expandConversation')
                      : t('shell.collapseConversation')
                  }
                  onClick={() => writeConversationPaneState(!isConversationCollapsed)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  {isConversationCollapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
                </Button>

                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={statusClassName} />
                  <span>{statusLabels[previewStatus]}</span>
                </div>
                <div className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                  {previewFilenameNode}
                </div>
                <div className="flex items-center gap-1">
                  {previewActions ?? (
                    <>
                      <Select
                        onValueChange={(value) => {
                          if (value === 'desktop' || value === 'mobile') {
                            setPreviewDevice(value);
                          }
                        }}
                        value={previewDevice}
                      >
                        <SelectTrigger
                          aria-label={t('preview.device')}
                          className="h-7 w-22 px-2 text-xs"
                          size="sm"
                        >
                          <SelectValue>
                            {previewDevice === 'desktop'
                              ? t('preview.deviceDesktop')
                              : t('preview.deviceMobile')}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent align="end" className="min-w-28">
                          <SelectGroup>
                            <SelectItem value="desktop">{t('preview.deviceDesktop')}</SelectItem>
                            <SelectItem value="mobile">{t('preview.deviceMobile')}</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          disabled={!previewProjectId}
                          render={
                            <Button
                              aria-label={t('download.label')}
                              size="icon-sm"
                              type="button"
                              variant="ghost"
                            >
                              <DownloadIcon />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end" className="min-w-44">
                          <DropdownMenuItem
                            disabled={!currentHtmlDownloadUrl}
                            onClick={() => {
                              if (currentHtmlDownloadUrl) {
                                triggerBrowserDownload(currentHtmlDownloadUrl);
                              }
                            }}
                          >
                            {t('download.currentHtml')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!workspaceZipDownloadUrl}
                            onClick={() => {
                              if (workspaceZipDownloadUrl) {
                                triggerBrowserDownload(workspaceZipDownloadUrl);
                              }
                            }}
                          >
                            {t('download.zip')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        aria-label={t('preview.refresh')}
                        onClick={() => {
                          window.dispatchEvent(new Event(PREVIEW_REFRESH_EVENT));
                        }}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <RefreshCwIcon />
                      </Button>
                      <Button
                        aria-label={t('preview.openExternal')}
                        disabled={!effectivePreviewHref}
                        onClick={() => {
                          if (effectivePreviewHref) {
                            window.open(effectivePreviewHref, '_blank', 'noopener');
                          }
                        }}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <ExternalLinkIcon />
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <div className="relative min-h-0 flex-1 overflow-hidden">
                {previewBodyNode ?? (
                  <div className="flex size-full items-center justify-center p-10">
                    <ConversationEmptyState
                      description={t('preview.emptyDescription')}
                      title={t('preview.emptyTitle')}
                    />
                  </div>
                )}
              </div>
            </div>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
}

function subscribeToConversationPaneState(onStoreChange: () => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === CONVERSATION_PANE_STORAGE_KEY) {
      onStoreChange();
    }
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(CONVERSATION_PANE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(CONVERSATION_PANE_EVENT, onStoreChange);
  };
}

function readConversationPaneState() {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(CONVERSATION_PANE_STORAGE_KEY) === 'true';
}

function writeConversationPaneState(value: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(CONVERSATION_PANE_STORAGE_KEY, String(value));
  window.dispatchEvent(new Event(CONVERSATION_PANE_EVENT));
}

function buildProjectDownloadPath(
  projectId: string,
  kind: 'current-html' | 'workspace-zip',
  previewPath?: string,
) {
  const params = new URLSearchParams({ kind });

  if (kind === 'current-html' && previewPath) {
    params.set('previewPath', previewPath);
  }

  return `/api/projects/${encodeURIComponent(projectId)}/download?${params.toString()}`;
}

function triggerBrowserDownload(url: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = '';
  document.body.append(link);
  link.click();
  link.remove();
}

function PreviewFileSelect({
  activePath,
  files,
  onChange,
}: {
  activePath?: string;
  files: string[];
  onChange: (path: string) => void;
}) {
  const { t } = useI18n();

  if (files.length === 0) {
    return <span className="font-mono text-xs text-muted-foreground">{t('preview.notFound')}</span>;
  }

  return (
    <Select
      onValueChange={(value) => {
        if (value) {
          onChange(value);
        }
      }}
      value={activePath ?? files[0]}
    >
      <SelectTrigger
        aria-label={t('preview.switchHtml')}
        className="h-7 max-w-full border-0 bg-transparent px-1.5 font-mono text-xs text-muted-foreground shadow-none"
        size="sm"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start" className="max-w-[min(420px,calc(100vw-2rem))]">
        <SelectGroup>
          {files.map((file) => (
            <SelectItem key={file} value={file}>
              <span className="font-mono text-xs">{file}</span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
