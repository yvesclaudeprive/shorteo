import { useState } from "react";
import { ArrowDownToLine, LoaderCircle, Sparkles, X } from "lucide-react";
import { useStore } from "../app/store";
import { installUpdate, snoozeUpdate, ui } from "../app/controller";
import { platform } from "../app/platform";

/** Lignes « - … » des notes de version (les nouveautés). */
export function updateNotes(notes: string, max = 4): string[] {
  return notes
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[-*•]\s+/.test(l))
    .map((l) => l.replace(/^[-*•]\s+/, ""))
    .slice(0, max);
}

/** Bandeau « nouvelle version disponible » en haut de la fenêtre. */
export function UpdateBanner() {
  const { update, updateState } = useStore(ui);
  const [open, setOpen] = useState(false);
  if (!update) return null;
  const busy = updateState === "downloading";
  const notes = updateNotes(update.notes);
  return (
    <div className={`update-banner ${open ? "open" : ""}`} role="status">
      <div className="ub-row">
        <span className="ub-icon">
          <Sparkles size={15} />
        </span>
        <span className="ub-text">
          <b>Shorteo {update.latest}</b> est disponible <span className="ub-cur">(vous avez la {update.current})</span>
        </span>
        {notes.length > 0 && (
          <button className="ub-link" onClick={() => setOpen((o) => !o)}>
            {open ? "Masquer" : "Nouveautés"}
          </button>
        )}
        <span className="grow" />
        {busy ? (
          <span className="ub-busy">
            <LoaderCircle size={14} className="spin" /> Téléchargement… Shorteo va redémarrer
          </span>
        ) : (
          <>
            <button className="btn small btn-plain" onClick={snoozeUpdate} title="Ne plus proposer cette version pendant 3 jours">
              Plus tard
            </button>
            <button className="btn small primary" onClick={() => void installUpdate()}>
              <ArrowDownToLine size={14} /> Mettre à jour
            </button>
          </>
        )}
        {!busy && (
          <button className="ub-close" title="Fermer" onClick={() => ui.set({ update: null })}>
            <X size={13} />
          </button>
        )}
      </div>
      {open && (
        <div className="ub-notes">
          <ul>
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          <button className="ub-link" onClick={() => void platform.openUrl(update.page)}>
            Toutes les nouveautés
          </button>
        </div>
      )}
    </div>
  );
}
