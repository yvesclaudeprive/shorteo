import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronRight, Folder, Search, House } from "lucide-react";
import { useStore } from "../app/store";
import { indexVersion, getIndex } from "../app/index-store";
import { applyFilter, focusInput } from "../app/controller";
import { norm } from "../app/search";
import { childFolders, folderPath, PATH_SEP } from "../sources/drive";
import type { ResultItem } from "../sources/types";

/**
 * Choix d'un dossier Drive en naviguant dans l'arborescence (filtre « Dossier »).
 * Clic ou → : ouvrir le dossier ; « Choisir » ou Entrée : filtrer sur ce dossier ;
 * ← : remonter. La recherche par nom reste possible.
 */
export function FolderBrowser({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  useStore(indexVersion);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [cur, setCur] = useState<ResultItem | null>(null);
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);

  const rows: ResultItem[] = useMemo(() => {
    const n = norm(q.trim());
    if (n) {
      return getIndex("drive")
        .items.filter((i) => i.kind === "folder" && norm(i.title).includes(n))
        .sort((a, b) => (b.t ?? 0) - (a.t ?? 0))
        .slice(0, 80);
    }
    return childFolders(cur?.id ?? null);
  }, [q, cur]);

  useEffect(() => {
    inputRef.current?.focus();
    const onDown = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // phase de capture : vérifié avant que le clic ne modifie la liste affichée
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  useEffect(() => setIndex(0), [q, cur]);

  const choose = (f: ResultItem) => {
    onClose();
    applyFilter("dossier", folderPath(f).join(PATH_SEP));
  };
  const open = (f: ResultItem) => {
    setQ("");
    setCur(f);
  };
  const up = () => {
    if (!cur) return;
    const parent = cur.f?.p ? getIndex("drive").byId.get(cur.f.p) : undefined;
    setCur(parent && parent.kind === "folder" ? parent : null);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const r = rows[index];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "ArrowRight" && r && !q) {
      e.preventDefault();
      open(r);
    } else if (e.key === "ArrowLeft" && !q) {
      e.preventDefault();
      up();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (r) choose(r);
      else if (cur) choose(cur);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      focusInput();
    }
  };

  const crumbs = cur ? folderPath(cur) : [];
  const left = Math.max(8, Math.min(x, window.innerWidth - 388));
  const maxHeight = Math.max(240, window.innerHeight - y - 12);

  return (
    <div ref={ref} className="fmenu fmenu-wide" style={{ left, top: y, maxHeight }} role="dialog">
      <div className="fmenu-search">
        <Search size={14} />
        <input
          ref={inputRef}
          value={q}
          placeholder="Rechercher un dossier par son nom…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          spellCheck={false}
        />
      </div>
      {!q && (
        <div className="crumbs">
          <button className="crumb" onClick={() => setCur(null)}>
            <House size={13} /> Drive
          </button>
          {crumbs.map((name, i) => (
            <span key={`${name}-${i}`} className="crumb-wrap">
              <ChevronRight size={12} />
              <button
                className="crumb"
                onClick={() => {
                  let target: ResultItem | null = cur;
                  for (let k = crumbs.length - 1; k > i && target; k--) {
                    const p = target.f?.p ? getIndex("drive").byId.get(target.f.p) : undefined;
                    target = p && p.kind === "folder" ? p : null;
                  }
                  setCur(target);
                }}
              >
                {name}
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="fmenu-list" role="listbox">
        {!q && cur && (
          <button className="folder-choose-current" onClick={() => choose(cur)}>
            Chercher dans « {cur.title} » (sous-dossiers compris)
          </button>
        )}
        {rows.map((f, i) => {
          const subCount = childFolders(f.id).length;
          return (
            <div
              key={f.id}
              className={`folder-row ${i === index ? "sel" : ""}`}
              onMouseMove={() => setIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                if (q) choose(f);
                else open(f);
              }}
            >
              <span className="fav-icon">
                <Folder size={13} />
              </span>
              <span className="folder-name">
                {f.title}
                {q && <span className="folder-path">{folderPath(f).slice(0, -1).join(" › ")}</span>}
              </span>
              {!q && subCount > 0 && <span className="folder-count">{subCount}</span>}
              <button
                className="folder-pick"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  choose(f);
                }}
              >
                Choisir
              </button>
              {!q && subCount > 0 && <ChevronRight size={14} className="folder-chevron" />}
            </div>
          );
        })}
        {!rows.length && <div className="fmenu-empty">{q ? "Aucun dossier de ce nom" : "Aucun sous-dossier"}</div>}
      </div>
    </div>
  );
}
