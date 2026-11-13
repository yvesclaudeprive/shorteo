import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronLeft, ChevronRight, Folder, HardDrive, Search, Users, UserRound, X } from "lucide-react";
import { useStore } from "../app/store";
import { indexVersion, getIndex } from "../app/index-store";
import { clearFilterValues, focusInput, toggleFilterValue, ui } from "../app/controller";
import { opValues, parseQuery } from "../app/query";
import {
  childCount,
  childFolders,
  driveSource,
  ensureDriveRoots,
  folderByValue,
  folderPath,
  folderRoots,
  PATH_SEP,
  searchFolders,
  sharedDrives,
} from "../sources/drive";
import type { ResultItem } from "../sources/types";

/** Niveau affiché : accueil (Mon Drive / Drives partagés), une racine, ou un dossier. */
type Level =
  | { kind: "home" }
  | { kind: "mydrive" }
  | { kind: "shared" }
  | { kind: "others" }
  | { kind: "folder"; item: ResultItem };

interface Row {
  key: string;
  label: string;
  icon: "folder" | "drive" | "shared" | "others";
  count: number;
  /** ouvrir ce niveau (→ ou clic) */
  level?: Level;
  /** dossier ou drive partagé : peut être choisi comme filtre */
  item?: ResultItem;
  path?: string;
}

const LEVEL_TITLE: Record<Exclude<Level["kind"], "folder">, string> = {
  home: "Drive",
  mydrive: "Mon Drive",
  shared: "Drives partagés",
  others: "Partagés avec moi",
};

function levelTitle(l: Level): string {
  return l.kind === "folder" ? l.item.title : LEVEL_TITLE[l.kind];
}

function levelKey(l: Level): string {
  return l.kind === "folder" ? `f:${l.item.id}` : l.kind;
}

function folderRow(f: ResultItem): Row {
  const n = childCount(f.id);
  return { key: f.id, label: f.title, icon: f.f?.drive ? "shared" : "folder", count: n, item: f, level: { kind: "folder", item: f } };
}

function rowsOf(level: Level): Row[] {
  const roots = folderRoots();
  switch (level.kind) {
    case "home": {
      const rows: Row[] = [
        { key: "mydrive", label: "Mon Drive", icon: "drive", count: roots.myDrive.length, level: { kind: "mydrive" } },
        { key: "shared", label: "Drives partagés", icon: "shared", count: roots.shared.length, level: { kind: "shared" } },
      ];
      if (roots.others.length) {
        rows.push({ key: "others", label: "Partagés avec moi", icon: "others", count: roots.others.length, level: { kind: "others" } });
      }
      return rows;
    }
    case "mydrive":
      return roots.myDrive.map(folderRow);
    case "shared":
      return roots.shared.map(folderRow);
    case "others":
      return roots.others.map(folderRow);
    case "folder":
      return childFolders(level.item.id).map(folderRow);
  }
}

function RowIcon({ icon }: { icon: Row["icon"] }) {
  const Icon = icon === "drive" ? HardDrive : icon === "shared" ? Users : icon === "others" ? UserRound : Folder;
  return (
    <span className={`fav-icon folder-ico-${icon}`}>
      <Icon size={13} />
    </span>
  );
}

/**
 * Choix d'un ou plusieurs dossiers Drive en naviguant dans l'arborescence (filtre
 * « Dossier »), à la manière d'un menu mobile : chaque niveau glisse depuis la droite.
 * Départ : Mon Drive / Drives partagés (/ Partagés avec moi).
 * Case à cocher, Entrée ou Espace : cocher / décocher ; clic sur le nom ou → : ouvrir ;
 * ← : revenir ; OK ou Échap : fermer. Les dossiers cochés s'additionnent (l'un OU l'autre).
 */
export function FolderBrowser({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const { v } = useStore(indexVersion);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [stack, setStack] = useState<Level[]>([{ kind: "home" }]);
  const [dir, setDir] = useState<"fwd" | "back" | "none">("none");
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const [rootsTick, setRootsTick] = useState(0);
  const level = stack[stack.length - 1];
  const query = useStore(ui).query;

  // dossiers cochés : identifiant → valeur écrite dans la barre (pour pouvoir la retirer)
  const chosen = useMemo(() => {
    const vals = opValues(parseQuery(query, driveSource), "dossier");
    const byId = new Map<string, string>();
    const entries: Array<{ value: string; name: string; path: string }> = [];
    for (const val of vals) {
      const f = folderByValue(val);
      if (f) byId.set(f.id, val);
      entries.push({
        value: val,
        name: f?.title ?? val.split(PATH_SEP).pop() ?? val,
        path: f ? folderPath(f).join(" › ") : val,
      });
    }
    return { byId, entries, count: vals.length };
  }, [query, v, rootsTick]);

  // racine « Mon Drive » et drives partagés : chargés à la première ouverture
  useEffect(() => {
    let alive = true;
    void ensureDriveRoots()
      .then((changed) => alive && changed && setRootsTick((t) => t + 1))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const rows: Row[] = useMemo(() => {
    if (q.trim()) {
      return searchFolders(q).map((f) => ({
        key: f.id,
        label: f.title,
        icon: f.f?.drive ? "shared" : "folder",
        count: 0,
        item: f,
        path: folderPath(f).slice(0, -1).join(" › "),
      }));
    }
    return rowsOf(level);
    // v / rootsTick : recalcul quand l'index ou les drives changent
  }, [q, level, v, rootsTick]);

  useEffect(() => {
    inputRef.current?.focus();
    const onDown = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // phase de capture : vérifié avant que le clic ne modifie la liste affichée
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  useEffect(() => {
    setIndex(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [q, stack]);

  const toggle = (f: ResultItem) => {
    toggleFilterValue("dossier", chosen.byId.get(f.id) ?? folderPath(f).join(PATH_SEP));
    inputRef.current?.focus();
  };
  const close = () => {
    onClose();
    focusInput();
  };
  const open = (l: Level) => {
    setQ("");
    setDir("fwd");
    setStack((s) => [...s, l]);
  };
  const backTo = (depth: number) => {
    if (depth >= stack.length - 1) return;
    setDir("back");
    setStack((s) => s.slice(0, Math.max(1, depth + 1)));
  };
  const back = () => backTo(stack.length - 2);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const r = rows[index];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "ArrowRight" && r?.level && !q && (r.count > 0 || !r.item)) {
      e.preventDefault();
      open(r.level);
    } else if ((e.key === "ArrowLeft" || e.key === "Backspace") && !q) {
      e.preventDefault();
      back();
    } else if (e.key === "Enter" || (e.key === " " && !q)) {
      e.preventDefault();
      if (r?.item) toggle(r.item);
      else if (r?.level) open(r.level);
      else if (level.kind === "folder") toggle(level.item);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const left = Math.max(8, Math.min(x, window.innerWidth - 388));
  const maxHeight = Math.max(260, window.innerHeight - y - 12);
  const empty =
    q.trim()
      ? "Aucun dossier de ce nom"
      : level.kind === "shared"
        ? sharedDrives().length || getIndex("drive").meta.rootsAt
          ? "Aucun drive partagé"
          : "Chargement des drives partagés…"
        : "Aucun sous-dossier";

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
        <div className="fnav">
          {stack.length > 1 ? (
            <button className="fnav-back" title="Retour (←)" onClick={back}>
              <ChevronLeft size={15} />
            </button>
          ) : (
            <span className="fnav-back placeholder" />
          )}
          <div className="crumbs">
            {stack.map((l, i) => {
              // chemin long : Drive › … › parent › dossier courant (sur une ligne)
              const hidden = stack.length > 3 && i > 0 && i < stack.length - 2;
              if (hidden && i > 1) return null;
              return (
                <span key={levelKey(l)} className="crumb-wrap">
                  {i > 0 && <ChevronRight size={12} />}
                  {hidden ? (
                    <button className="crumb" title={stack.slice(1, -2).map(levelTitle).join(" › ")} onClick={() => backTo(stack.length - 3)}>
                      …
                    </button>
                  ) : (
                    <button
                      className={`crumb ${i === stack.length - 1 ? "current" : ""}`}
                      title={levelTitle(l)}
                      onClick={() => backTo(i)}
                    >
                      {levelTitle(l)}
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}
      <div ref={listRef} className="fmenu-list fmenu-slide" role="listbox">
        <div key={q ? "search" : levelKey(level)} className={`fpanel ${q ? "none" : dir}`}>
          {!q && level.kind === "folder" && (
            <button
              className={`folder-choose-current ${chosen.byId.has(level.item.id) ? "on" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => toggle(level.item)}
            >
              <span className={`fcheck ${chosen.byId.has(level.item.id) ? "on" : ""}`}>
                {chosen.byId.has(level.item.id) && <Check size={11} strokeWidth={3} />}
              </span>
              <span className="folder-choose-name">Tout « {level.item.title} »</span>
              <span className="folder-choose-sub">sous-dossiers compris</span>
            </button>
          )}
          {rows.map((r, i) => {
            const on = !!r.item && chosen.byId.has(r.item.id);
            const opens = !q && (r.count > 0 || !r.item);
            return (
              <div
                key={r.key}
                role="option"
                aria-selected={on}
                className={`folder-row ${i === index ? "sel" : ""} ${on ? "on" : ""} ${r.item ? "" : "folder-row-root"}`}
                onMouseEnter={() => setIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  // clic sur le nom : ouvre le dossier s'il en contient d'autres, sinon le coche
                  if (opens && r.level) open(r.level);
                  else if (r.item) toggle(r.item);
                }}
              >
                {r.item ? (
                  <button
                    className={`fcheck ${on ? "on" : ""}`}
                    title={on ? "Décocher" : "Cocher"}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggle(r.item!);
                    }}
                  >
                    {on && <Check size={11} strokeWidth={3} />}
                  </button>
                ) : null}
                <RowIcon icon={r.icon} />
                <span className="folder-name">
                  {r.label}
                  {r.path && <span className="folder-path">{r.path}</span>}
                </span>
                {!q && r.count > 0 && <span className="folder-count">{r.count}</span>}
                {opens && <ChevronRight size={14} className="folder-chevron" />}
              </div>
            );
          })}
          {!rows.length && <div className="fmenu-empty">{empty}</div>}
        </div>
      </div>
      <div className="fmenu-foot">
        {chosen.count ? (
          <div className="fsel" aria-label="Dossiers choisis">
            {chosen.entries.map((e) => (
              <span key={e.value} className="fsel-tok" title={e.path}>
                <span className="fsel-name">{e.name}</span>
                <button
                  title={`Retirer « ${e.name} »`}
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => {
                    toggleFilterValue("dossier", e.value);
                    inputRef.current?.focus();
                  }}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <span className="fmenu-count">Cochez un ou plusieurs dossiers</span>
        )}
        {chosen.count > 1 && (
          <button className="btn small btn-plain" onMouseDown={(e) => e.preventDefault()} onClick={() => clearFilterValues("dossier")}>
            Tout retirer
          </button>
        )}
        <button className="btn small primary" onMouseDown={(e) => e.preventDefault()} onClick={close}>
          OK
        </button>
      </div>
    </div>
  );
}
