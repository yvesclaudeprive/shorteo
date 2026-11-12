import { Folder, ArrowUpRight } from "lucide-react";
import { useStore } from "../app/store";
import { settingsStore } from "../app/settings";
import { indexVersion } from "../app/index-store";
import { applyFilter, openItem, ui } from "../app/controller";
import { hasOp, parseQuery } from "../app/query";
import { driveShortcuts, driveSource, shortcutLabel } from "../sources/drive";
import { ItemIcon } from "./icons";

/**
 * Raccourcis en tête de la recherche Drive (réglables dans les paramètres).
 * Dossier : limite la recherche à ce dossier, sous-dossiers compris. Fichier : l'ouvre.
 */
export function DriveShortcuts() {
  const s = useStore(ui);
  useStore(settingsStore);
  useStore(indexVersion);
  const list = driveShortcuts().filter((x) => x.item);
  if (!list.length) return null;
  const q = parseQuery(s.query, driveSource);
  return (
    <div className="favs">
      {list.map(({ name, item }) => {
        const isFolder = item!.kind === "folder";
        const on = isFolder && hasOp(q, "dossier", name);
        return (
          <button
            key={name}
            className={`fav ${on ? "on" : ""}`}
            title={isFolder ? `Chercher dans « ${name} » (sous-dossiers compris)` : `Ouvrir « ${name} »`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (isFolder ? applyFilter("dossier", name) : void openItem(item!))}
          >
            <span className="fav-icon">{isFolder ? <Folder size={14} /> : <ItemIcon item={item!} size={14} />}</span>
            {shortcutLabel(name)}
            {!isFolder && <ArrowUpRight size={12} className="fav-open" />}
          </button>
        );
      })}
    </div>
  );
}
