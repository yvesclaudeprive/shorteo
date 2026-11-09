import { LoaderCircle, Minus, RefreshCw, Settings, TriangleAlert } from "lucide-react";
import { useStore } from "../app/store";
import { hideWindow, openSettings, syncAll, ui } from "../app/controller";
import { relativeDate } from "../app/format";

/** Masque la fenêtre (elle revient avec le raccourci ou l'icône près de l'horloge). */
export function MinimizeButton() {
  return (
    <button className="icon-btn" title="Réduire (Échap) — revient avec le raccourci ou l'icône près de l'horloge" onClick={() => void hideWindow()}>
      <Minus size={17} />
    </button>
  );
}

/** Indicateur de synchronisation + bouton paramètres (en haut à droite). */
export function TopActions() {
  const { sync } = useStore(ui);
  const title = sync.running
    ? sync.label ?? "Synchronisation…"
    : sync.errors.length
      ? sync.errors.join("\n")
      : sync.last
        ? `Index à jour (${relativeDate(sync.last)}) — Ctrl+R pour synchroniser`
        : "Ctrl+R pour synchroniser";
  return (
    <div className="top-actions">
      <button className={`sync-pill ${sync.errors.length ? "warn" : ""}`} title={title} onClick={() => void syncAll(false)}>
        {sync.running ? (
          <LoaderCircle size={13} className="spin" />
        ) : sync.errors.length ? (
          <TriangleAlert size={13} />
        ) : (
          <RefreshCw size={13} />
        )}
        <span>
          {sync.running
            ? sync.label ?? "Synchro…"
            : sync.errors.length
              ? "Erreur de synchro"
              : sync.last
                ? relativeDate(sync.last)
                : "Synchroniser"}
        </span>
      </button>
      <button className="icon-btn" title="Paramètres (Ctrl+,)" onClick={() => openSettings()}>
        <Settings size={16} />
      </button>
      <MinimizeButton />
    </div>
  );
}
