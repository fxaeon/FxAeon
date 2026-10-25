/** Session-only display state. Never stores wallet, form, review or signing data. */
export type RouteScrollPosition = { top: number; left: number };

export function createRouteScrollMemory(capacity = 32) {
  const positions = new Map<string, RouteScrollPosition>();
  return {
    read(pathname: string): RouteScrollPosition {
      const position = positions.get(pathname);
      return position ? { ...position } : { top: 0, left: 0 };
    },
    save(pathname: string, position: RouteScrollPosition) {
      if (!pathname.startsWith('/') || !Number.isFinite(position.top) || !Number.isFinite(position.left)) return;
      positions.delete(pathname);
      positions.set(pathname, { top: Math.max(0, position.top), left: Math.max(0, position.left) });
      while (positions.size > Math.max(1, capacity)) positions.delete(positions.keys().next().value!);
    },
  };
}

export const routeScrollMemory = createRouteScrollMemory();
