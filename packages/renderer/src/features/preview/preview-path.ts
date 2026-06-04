import { useAppLocation, useAppNavigate, useAppSearchParams } from '@/lib/router';
import { useCallback, useSyncExternalStore } from 'react';

let currentPreviewPath: string | undefined;
const currentPreviewPathListeners = new Set<() => void>();

export function getCurrentPreviewPath() {
  return currentPreviewPath;
}

export function setCurrentPreviewPath(path: string | undefined) {
  if (currentPreviewPath === path) {
    return;
  }

  currentPreviewPath = path;
  currentPreviewPathListeners.forEach((listener) => listener());
}

export function useCurrentPreviewPath() {
  return useSyncExternalStore(
    subscribeToCurrentPreviewPath,
    getCurrentPreviewPath,
    getCurrentPreviewPath,
  );
}

function subscribeToCurrentPreviewPath(listener: () => void) {
  currentPreviewPathListeners.add(listener);

  return () => {
    currentPreviewPathListeners.delete(listener);
  };
}

export function usePreviewPath() {
  const { pathname } = useAppLocation();
  const navigate = useAppNavigate();
  const [searchParams] = useAppSearchParams();
  const previewPath = searchParams.get('previewPath') ?? undefined;

  const setPreviewPath = useCallback(
    (nextPreviewPath: string | undefined, options: { replace?: boolean } = {}) => {
      const params = new URLSearchParams(window.location.search);

      if (nextPreviewPath) {
        params.set('previewPath', nextPreviewPath);
      } else {
        params.delete('previewPath');
      }

      const nextSearch = params.toString();
      navigate(nextSearch ? `${pathname}?${nextSearch}` : pathname, {
        preventScrollReset: true,
        replace: options.replace ?? true,
      });
    },
    [navigate, pathname],
  );

  return [previewPath, setPreviewPath] as const;
}
