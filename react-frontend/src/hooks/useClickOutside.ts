import { useEffect, useRef, type RefObject } from 'react'

/** Calls `handler` on clicks outside the referenced element (closing menus, popovers) */
export function useClickOutside(target: RefObject<HTMLElement | null>, handler: () => void): void {
  const latest = useRef(handler)
  latest.current = handler

  useEffect(() => {
    const listener = (event: MouseEvent) => {
      if (target.current && !target.current.contains(event.target as Node)) latest.current()
    }
    document.addEventListener('click', listener)
    return () => document.removeEventListener('click', listener)
  }, [target])
}
