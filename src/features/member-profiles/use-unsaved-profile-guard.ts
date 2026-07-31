"use client";

import { useEffect } from "react";

export function shouldConfirmProfileNavigation(
  targetHref: string,
  currentHref: string,
) {
  const target = new URL(targetHref, currentHref);
  const current = new URL(currentHref);

  if (target.href === current.href) return false;

  return !(
    target.origin === current.origin &&
    target.pathname === current.pathname &&
    target.search === current.search
  );
}

export function useUnsavedProfileGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    const handleDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      ) {
        return;
      }

      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      ) {
        return;
      }

      const href = anchor.getAttribute("href");
      if (
        !href ||
        !shouldConfirmProfileNavigation(href, window.location.href)
      ) {
        return;
      }

      if (!window.confirm("Discard unsaved profile changes?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleDocumentClick, true);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [dirty]);
}
