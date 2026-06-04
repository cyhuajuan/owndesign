import {
  type NavigateFunction,
  useLocation as useReactRouterLocation,
  useNavigate as useReactRouterNavigate,
  useSearchParams as useReactRouterSearchParams,
} from 'react-router';

export function useAppLocation() {
  try {
    return useReactRouterLocation();
  } catch {
    return {
      hash: window.location.hash,
      key: 'fallback',
      pathname: window.location.pathname || '/',
      search: window.location.search,
      state: null,
    };
  }
}

export function useAppNavigate() {
  try {
    return useReactRouterNavigate();
  } catch {
    return ((to: string) => {
      window.history.pushState(null, '', to);
    }) as NavigateFunction;
  }
}

export function useAppSearchParams() {
  try {
    return useReactRouterSearchParams();
  } catch {
    return [new URLSearchParams(window.location.search), () => {}] as const;
  }
}
