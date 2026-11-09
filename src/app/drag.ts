import type { MouseEvent as ReactMouseEvent } from "react";
import { platform } from "./platform";

/**
 * À brancher sur onMouseDown d'une barre de titre : la fenêtre suit la souris
 * dès qu'elle bouge de quelques pixels, bouton enfoncé. Un simple clic reste un clic.
 */
export function dragHandle(e: ReactMouseEvent): void {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement;
  if (target.closest("input, select, textarea, [data-no-drag]")) return;
  const sx = e.screenX;
  const sy = e.screenY;
  const cleanup = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", cleanup);
  };
  const move = (ev: MouseEvent) => {
    if (Math.abs(ev.screenX - sx) + Math.abs(ev.screenY - sy) < 4) return;
    cleanup();
    // un éventuel clic émis à la fin du déplacement ne doit rien déclencher
    const stop = (c: Event) => c.stopPropagation();
    window.addEventListener("click", stop, { capture: true, once: true });
    void platform
      .startDrag()
      .catch(() => {})
      .finally(() => window.setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 300));
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", cleanup);
}
