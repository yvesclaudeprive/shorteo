import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Check, ChevronDown, Plus, X, Search } from "lucide-react";
import { useStore } from "../app/store";
import {
  applyFilter,
  clearAllFilters,
  clearFilter,
  clearFilterValues,
  focusInput,
  insertOperator,
  toggleChip,
  toggleFilterValue,
  ui,
} from "../app/controller";
import { hasOp, opValues, parseQuery, valueLabel } from "../app/query";
import { norm } from "../app/search";
import { sourceDef } from "../sources/registry";
import type { OperatorDef, OperatorValue, SourceDef } from "../sources/types";
import { FolderBrowser } from "./FolderBrowser";

interface MenuState {
  key: string;
  x: number;
  y: number;
}

interface Option {
  value: string;
  label: string;
  detail?: string;
}

/**
 * Menu d'un filtre (ou liste de tous les filtres).
 * Filtre à choix multiple : cases à cocher, le menu reste ouvert pendant qu'on coche.
 * Filtre à choix unique (dates, tri…) : un clic choisit et ferme.
 */
function FilterMenu({ src, menu, onClose }: { src: SourceDef; menu: MenuState; onClose: () => void }) {
  const query = useStore(ui).query;
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const isOps = menu.key === "__ops";
  const op = src.operators.find((o) => o.key === menu.key);
  const multi = !!op?.multi;

  // valeurs déjà cochées (dans la barre de recherche)
  const selected = useMemo(() => (op ? opValues(parseQuery(query, src), op.key) : []), [query, op, src]);
  const isOn = (v: string) => selected.some((x) => norm(x) === norm(v));

  const options: Option[] = useMemo(() => {
    if (isOps) {
      return src.operators.map((o) => ({ value: o.aliases[0], label: o.label, detail: `${o.aliases[0]}:` }));
    }
    const list = (op?.values?.() ?? []).map((v: OperatorValue) => ({ value: v.value, label: v.label ?? v.value, detail: v.detail }));
    if (!multi) return list;
    // cochées d'abord (y compris une valeur tapée à la main), pour les décocher vite
    const known = new Set(list.map((o) => norm(o.value)));
    const extra = selected.filter((v) => !known.has(norm(v))).map((v) => ({ value: v, label: v }));
    const on = list.filter((o) => selected.some((x) => norm(x) === norm(o.value)));
    const off = list.filter((o) => !selected.some((x) => norm(x) === norm(o.value)));
    return [...extra, ...on, ...off];
    // la liste ne se réordonne pas pendant qu'on coche : seulement à l'ouverture
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOps, op, src, multi]);

  const filtered = useMemo(() => {
    const n = norm(q.trim());
    if (!n) return options.slice(0, 120);
    return options.filter((o) => norm(`${o.label} ${o.value} ${o.detail ?? ""}`).includes(n)).slice(0, 120);
  }, [options, q]);

  useEffect(() => {
    inputRef.current?.focus();
    const onDown = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // phase de capture : vérifié avant que le clic ne modifie la liste affichée
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  useEffect(() => setIndex(0), [q]);

  const close = () => {
    onClose();
    focusInput();
  };

  const choose = (o: Option) => {
    if (isOps) {
      onClose();
      insertOperator(o.value);
    } else if (op && multi) {
      toggleFilterValue(op.key, o.value);
      inputRef.current?.focus();
    } else if (op) {
      onClose();
      applyFilter(op.key, o.value);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = filtered[index];
      if (o) choose(o);
      else if (op && q.trim()) {
        if (multi) {
          toggleFilterValue(op.key, q.trim());
          setQ("");
        } else {
          onClose();
          applyFilter(op.key, q.trim());
        }
      } else if (multi) close();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 348));
  const maxHeight = Math.max(200, window.innerHeight - menu.y - 12);
  return (
    <div ref={ref} className="fmenu" style={{ left, top: menu.y, maxHeight }} role="dialog">
      <div className="fmenu-search">
        <Search size={14} />
        <input
          ref={inputRef}
          value={q}
          placeholder={isOps ? "Rechercher un filtre…" : `Rechercher (${op?.label ?? ""})…`}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          spellCheck={false}
        />
      </div>
      <div className="fmenu-list" role="listbox" aria-multiselectable={multi || undefined}>
        {op?.dates && !q.trim() && (
          <div className="fmenu-dates" onMouseDown={(e) => e.stopPropagation()}>
            <div className="fmenu-dates-title">Dates personnalisées</div>
            <div className="fmenu-dates-row">
              <label>
                Du
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                Au
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
              <button
                className="btn primary"
                disabled={!from && !to}
                onClick={() => {
                  onClose();
                  applyFilter(op.key, `${from}..${to}`);
                }}
              >
                OK
              </button>
            </div>
          </div>
        )}
        {filtered.map((o, i) => {
          const on = !isOps && isOn(o.value);
          return (
            <div
              key={`${o.value}-${i}`}
              role="option"
              aria-selected={on}
              className={`fmenu-item ${i === index ? "sel" : ""} ${on ? "on" : ""}`}
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o);
              }}
            >
              {multi && <span className={`fcheck ${on ? "on" : ""}`}>{on && <Check size={11} strokeWidth={3} />}</span>}
              <span className="fmenu-label">{o.label}</span>
              {o.detail && <span className="fmenu-detail">{o.detail}</span>}
              {!multi && on && <Check size={14} className="fmenu-tick" />}
            </div>
          );
        })}
        {!filtered.length && (
          <div className="fmenu-empty">
            {op && q.trim() ? <>Entrée pour {multi ? "ajouter" : "filtrer sur"} « {q.trim()} »</> : "Aucune valeur connue pour l'instant"}
          </div>
        )}
      </div>
      {multi && op && (
        <div className="fmenu-foot">
          <span className="fmenu-count">
            {selected.length ? `${selected.length} choisi${selected.length > 1 ? "s" : ""}` : "Cochez une ou plusieurs valeurs"}
          </span>
          {selected.length > 0 && (
            <button className="btn small btn-plain" onMouseDown={(e) => e.preventDefault()} onClick={() => clearFilterValues(op.key)}>
              Effacer
            </button>
          )}
          <button className="btn small primary" onMouseDown={(e) => e.preventDefault()} onClick={close}>
            OK
          </button>
        </div>
      )}
    </div>
  );
}

/** Texte d'une pastille : « Docs, Sheets » ou « Docs +2 ». */
function chipText(op: OperatorDef, values: string[]): string {
  const labels = values.map((v) => valueLabel(op, v).split(" / ").pop() ?? v);
  return labels.length <= 2 ? labels.join(", ") : `${labels[0]} +${labels.length - 1}`;
}

/** Filtres sous la barre de recherche, à la manière de la recherche native des outils. */
export function FilterBar() {
  const s = useStore(ui);
  const src = sourceDef(s.source);
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => setMenu(null), [s.source]);

  if (!src) {
    return (
      <div className="chips">
        <span className="chips-hint">
          Astuce : <kbd>Alt+2</kbd> à <kbd>Alt+7</kbd> relance la même recherche dans un seul outil, avec ses filtres.
        </span>
      </div>
    );
  }

  const q = parseQuery(s.query, src);
  const bar = (src.filterBar ?? [])
    .map((k) => src.operators.find((o) => o.key === k))
    .filter((o): o is OperatorDef => !!o);
  const quick = src.chips.filter((c) => !(src.filterBar ?? []).includes(c.op));
  const activeCount = new Set(q.ops.map((o) => o.key)).size;

  const open = (key: string, e: MouseEvent<HTMLElement>) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu((m) => (m?.key === key ? null : { key, x: r.left, y: r.bottom + 6 }));
  };

  return (
    <div className="chips">
      {bar.map((op) => {
        const active = q.ops.filter((o) => o.key === op.key && !o.negate).map((o) => o.value);
        const text = active.length ? chipText(op, active) : null;
        return (
          <span
            key={op.key}
            className={`fchip ${active.length ? "on" : ""} ${menu?.key === op.key ? "open" : ""}`}
            title={active.length ? active.map((v) => valueLabel(op, v)).join("\n") : undefined}
          >
            <button className="fchip-main" onMouseDown={(e) => e.preventDefault()} onClick={(e) => open(op.key, e)}>
              <span className="fchip-label">{op.label}</span>
              {text && <span className="fchip-value">{text}</span>}
              {!text && <ChevronDown size={13} />}
            </button>
            {active.length > 0 && (
              <button
                className="fchip-x"
                title="Retirer ce filtre"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => clearFilter(op.key)}
              >
                <X size={12} />
              </button>
            )}
          </span>
        );
      })}
      {quick.map((c) => (
        <button
          key={`${c.op}:${c.value}`}
          className={`chip ${hasOp(q, c.op, c.value) ? "on" : ""}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleChip(c)}
        >
          {c.label}
        </button>
      ))}
      <button
        className={`chip chip-more ${menu?.key === "__ops" ? "on" : ""}`}
        title="Tous les filtres"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => open("__ops", e)}
      >
        <Plus size={13} /> Filtre
      </button>
      {activeCount > 1 && (
        <button className="chip chip-clear" title="Retirer tous les filtres" onMouseDown={(e) => e.preventDefault()} onClick={clearAllFilters}>
          <X size={12} /> Tout effacer
        </button>
      )}
      {menu && src.key === "drive" && menu.key === "dossier" ? (
        <FolderBrowser x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
      ) : (
        menu && <FilterMenu src={src} menu={menu} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
