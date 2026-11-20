'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

export function NavigationProgress() {
  const pathname = usePathname();
  const previousPath = useRef(pathname);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const routeWatchTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestCount = useRef(0);
  const routePending = useRef(false);
  const routeTarget = useRef<string | null>(null);
  const [active, setActive] = useState(false);
  const [progress, setProgress] = useState(0);

  const begin = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    if (finishTimer.current) clearTimeout(finishTimer.current);
    setActive(true);
    setProgress(8);
    timer.current = setInterval(() => {
      setProgress((value) => Math.min(value + Math.max(1, (90 - value) * 0.08), 90));
    }, 180);
  }, []);

  const finishIfIdle = useCallback(() => {
    if (routePending.current || requestCount.current > 0) return;
    if (timer.current) clearInterval(timer.current);
    setProgress(100);
    finishTimer.current = setTimeout(() => {
      setActive(false);
      setProgress(0);
    }, 180);
  }, []);

  const startNavigation = useCallback((target: string) => {
    routePending.current = true;
    routeTarget.current = target;
    begin();
    if (routeWatchTimer.current) clearInterval(routeWatchTimer.current);
    const startedAt = Date.now();
    routeWatchTimer.current = setInterval(() => {
      const current = `${window.location.pathname}${window.location.search}`;
      if (current === routeTarget.current || Date.now() - startedAt > 15000) {
        if (routeWatchTimer.current) clearInterval(routeWatchTimer.current);
        routeWatchTimer.current = null;
        routePending.current = false;
        routeTarget.current = null;
        finishIfIdle();
      }
    }, 100);
  }, [begin, finishIfIdle]);

  useEffect(() => {
    function onDocumentClick(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest('a[href]');
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.hasAttribute('download')) return;
      const next = new URL(link.href, window.location.href);
      const current = `${window.location.pathname}${window.location.search}`;
      const destination = `${next.pathname}${next.search}`;
      if (next.origin === window.location.origin && destination !== current) startNavigation(destination);
    }

    // Next.js server actions and same-origin API mutations use fetch. Track them
    // so saves and other actions get the same feedback as page navigation.
    const originalFetch = window.fetch;
    const trackedFetch: typeof window.fetch = async (input, init) => {
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const shouldTrack = method !== 'GET' && method !== 'HEAD';
      if (!shouldTrack) return originalFetch.call(window, input, init);
      requestCount.current += 1;
      begin();
      try {
        return await originalFetch.call(window, input, init);
      } finally {
        requestCount.current -= 1;
        finishIfIdle();
      }
    };
    window.fetch = trackedFetch;

    // Capture before Next.js Link prevents the browser's default navigation.
    document.addEventListener('click', onDocumentClick, true);
    const onPopState = () => startNavigation(`${window.location.pathname}${window.location.search}`);
    const onProgrammaticNavigation = (event: Event) => {
      const href = (event as CustomEvent<string>).detail;
      if (!href) return;
      const destination = new URL(href, window.location.href);
      if (destination.origin === window.location.origin) {
        startNavigation(`${destination.pathname}${destination.search}`);
      }
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('workline:navigation-start', onProgrammaticNavigation);
    return () => {
      document.removeEventListener('click', onDocumentClick, true);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('workline:navigation-start', onProgrammaticNavigation);
      if (routeWatchTimer.current) clearInterval(routeWatchTimer.current);
      if (window.fetch === trackedFetch) window.fetch = originalFetch;
    };
  }, [begin, finishIfIdle, startNavigation]);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    routePending.current = false;
    routeTarget.current = null;
    if (routeWatchTimer.current) clearInterval(routeWatchTimer.current);
    routeWatchTimer.current = null;
    finishIfIdle();
  }, [finishIfIdle, pathname]);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    if (routeWatchTimer.current) clearInterval(routeWatchTimer.current);
    if (finishTimer.current) clearTimeout(finishTimer.current);
  }, []);

  return (
    <div className="navigation-progress" aria-hidden="true" data-active={active}>
      <div className="navigation-progress__bar" style={{ transform: `scaleX(${progress / 100})` }} />
    </div>
  );
}
