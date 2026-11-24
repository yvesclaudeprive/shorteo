import { useStore } from "../app/store";
import { settingsStore } from "../app/settings";
import { ui } from "../app/controller";
import { shortcutLabel, toolLetter } from "../app/shortcuts";
import { BAR_ORDER, sourceLabel } from "../sources/registry";

/**
 * Pense-bête discret en bas de la fenêtre : Alt + lettre pour changer d'onglet,
 * et les raccourcis qui marchent partout dans Windows.
 */
export function KeysStrip() {
  const st = useStore(settingsStore);
  const { source } = useStore(ui);
  const letters = BAR_ORDER.map((id) => ({ id, letter: toolLetter(id, st.toolShortcuts) }));
  // tous les outils suivent « Ctrl+Alt + même lettre » ? (sinon : voir les infobulles des onglets)
  const sameLetter = letters
    .filter((l) => l.id !== "all")
    .every((l) => {
      const g = st.toolShortcuts[l.id as Exclude<typeof l.id, "all">];
      return !g || g.toUpperCase() === `CTRL+ALT+${l.letter}`;
    });
  return (
    <div className="keys-strip" aria-label="Raccourcis clavier">
      <span className="ks-group">
        <span className="ks-title">Onglets</span>
        <kbd>Alt</kbd>+
        {letters.map((l) => (
          <span key={l.id} className={`ks-item ${l.id === source ? "on" : ""}`}>
            <kbd>{l.letter}</kbd>
            {sourceLabel(l.id)}
          </span>
        ))}
      </span>
      <span className="ks-sep" />
      <span className="ks-group">
        <span className="ks-title">Partout dans Windows</span>
        <kbd>{shortcutLabel(st.shortcut)}</kbd> Shorteo
        {sameLetter && (
          <>
            <span className="ks-dot">·</span>
            <kbd>Ctrl+Alt</kbd>+ même lettre
          </>
        )}
      </span>
    </div>
  );
}
