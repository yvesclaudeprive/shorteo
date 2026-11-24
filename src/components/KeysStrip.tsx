import { useStore } from "../app/store";
import { settingsStore } from "../app/settings";
import { ui } from "../app/controller";
import { globalLetter, shortcutLabel, toolLetter } from "../app/shortcuts";
import { BAR_ORDER, sourceLabel } from "../sources/registry";
import type { SourceKey } from "../sources/types";
import { LetterLabel } from "./LetterLabel";

/**
 * Pense-bête discret en bas de la fenêtre : Alt + lettre pour changer d'onglet,
 * et les raccourcis qui marchent partout dans Windows.
 */
export function KeysStrip() {
  const st = useStore(settingsStore);
  const { source } = useStore(ui);
  const tools = BAR_ORDER.filter((id): id is SourceKey => id !== "all");
  // partout dans Windows : Ctrl+Alt + même lettre, sauf exceptions (Mails S, Claude L…)
  const differ = tools
    .map((id) => ({ id, g: st.toolShortcuts[id], gl: globalLetter(st.toolShortcuts[id] ?? "") }))
    .filter((t) => t.g && t.gl !== toolLetter(t.id));
  return (
    <div className="keys-strip" aria-label="Raccourcis clavier">
      <span className="ks-group">
        <span className="ks-title">Onglets</span>
        <kbd className="ks-alt">Alt</kbd>
        <span className="ks-plus">+</span>
        {BAR_ORDER.map((id) => (
          <span key={id} className={`ks-item ${id === source ? "on" : ""}`}>
            <LetterLabel label={sourceLabel(id)} letter={toolLetter(id)} />
          </span>
        ))}
      </span>
      <span className="ks-sep" />
      <span className="ks-group ks-windows">
        <span className="ks-title">Windows</span>
        <kbd>{shortcutLabel(st.shortcut)}</kbd> Shorteo
        <span className="ks-dot">·</span>
        <kbd>Ctrl+Alt</kbd>+ lettre
        {differ.length > 0 && (
          <span className="ks-except">
            (
            {differ.map((t, i) => (
              <span key={t.id}>
                {i > 0 && ", "}
                {sourceLabel(t.id)} <kbd>{t.gl || shortcutLabel(t.g)}</kbd>
              </span>
            ))}
            )
          </span>
        )}
      </span>
    </div>
  );
}
