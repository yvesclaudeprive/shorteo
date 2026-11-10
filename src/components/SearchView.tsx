import { dragHandle } from "../app/drag";
import { useEffect, useRef } from "react";
import { ArrowUpRight, Copy, Globe, AppWindow, LoaderCircle, TriangleAlert, Plug, SearchX, Phone, Mail } from "lucide-react";
import { useStore } from "../app/store";
import { settingsStore } from "../app/settings";
import { indexVersion } from "../app/index-store";
import {
  copyLink,
  copyText,
  flatItems,
  openContact,
  itemKey,
  openItem,
  openSettings,
  runNative,
  selectKey,
  setSource,
  ui,
  willOpenInApp,
} from "../app/controller";
import { parseQuery } from "../app/query";
import { highlight } from "../app/search";
import { BAR_ORDER, SOURCES, sourceDef, sourceLabel } from "../sources/registry";
import type { ContactInfo, ResultItem } from "../sources/types";
import { ItemIcon, SourceTile, kindColor } from "./icons";
import { SearchBar } from "./SearchBar";
import { FilterBar } from "./FilterBar";
import { DriveShortcuts } from "./DriveShortcuts";
import { TopActions } from "./TopBar";

function SourcePills() {
  const { source } = useStore(ui);
  return (
    <nav className="pills">
      {BAR_ORDER.map((id, i) => (
        <button
          key={id}
          className={`pill ${id === source ? "active" : ""}`}
          title={`${sourceLabel(id)} (Alt+${i + 1})`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setSource(id)}
          style={{ ["--src" as string]: id === "all" ? "var(--accent)" : SOURCES[id].color }}
        >
          <SourceTile id={id} size={16} />
          <span>{sourceLabel(id)}</span>
        </button>
      ))}
    </nav>
  );
}

function Row({ item, selected, tokens }: { item: ResultItem; selected: boolean; tokens: string[] }) {
  const src = SOURCES[item.source];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const d = item.action === "native" || item.action === "switch" ? {} : src.describe(item);
  const special = item.action === "native" || item.action === "switch";
  return (
    <div
      ref={ref}
      className={`row ${selected ? "sel" : ""} ${item.unread ? "unread" : ""} ${special ? "row-action" : ""}`}
      onMouseMove={() => selectKey(itemKey(item))}
      onClick={(e) => void openItem(item, { web: e.ctrlKey })}
    >
      <span className="row-icon" style={{ ["--kind" as string]: kindColor(item) }}>
        <ItemIcon item={item} />
      </span>
      <div className="row-main">
        <div className="row-title">
          {item.unread && <span className="dot" />}
          <span className="row-title-text">
            {special || item.action === "ask"
              ? item.title
              : highlight(item.title, tokens).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
          </span>
        </div>
        {item.action === "native" && item.snippet ? (
          <div className="row-sub">{item.snippet}</div>
        ) : d.sub ? (
          <div className="row-sub">{d.sub}</div>
        ) : null}
        {item.snippet && item.action !== "native" && <div className="row-snippet">{item.snippet}</div>}
      </div>
      <div className="row-side">
        {d.badge && <span className={`badge tone-${d.badgeTone ?? "gray"}`}>{d.badge}</span>}
        {d.meta && <span className="row-meta">{d.meta}</span>}
        {item.action === "native" && <ArrowUpRight size={14} className="muted" />}
      </div>
    </div>
  );
}

function Results() {
  const s = useStore(ui);
  useStore(indexVersion);
  const src = sourceDef(s.source);
  const tokens = parseQuery(s.query, src).tokens;
  const items = flatItems(s.groups);
  const selKey = s.selectedKey ?? (items[0] ? itemKey(items[0]) : null);

  const single = s.groups.length === 1 ? s.groups[0] : null;
  if (single?.error === "notconfigured" && src) {
    return (
      <div className="empty">
        <Plug size={28} />
        <h3>{src.label} n'est pas encore connecté</h3>
        <p>Ajoutez votre accès dans les paramètres pour chercher ici.</p>
        <button className="btn primary" onClick={() => openSettings(src.key === "mail" || src.key === "drive" ? "google" : src.key)}>
          Connecter {src.label}
        </button>
      </div>
    );
  }
  if (!items.length && !s.liveLoading && !s.groups.some((g) => g.loading)) {
    const err = s.groups.find((g) => g.error)?.error;
    return (
      <div className="empty">
        {err ? <TriangleAlert size={28} /> : <SearchX size={28} />}
        <h3>{err ? "Recherche impossible" : s.query ? "Aucun résultat" : "Commencez à taper"}</h3>
        <p>{err ?? (s.query ? "Essayez d'autres mots ou retirez un filtre." : "Les résultats s'affichent au fil de la frappe.")}</p>
        {src && !src.actions && s.query.trim() && (
          <button className="btn" onClick={() => void runNative()}>
            {src.nativeSearch(parseQuery(s.query, src)).label} <ArrowUpRight size={14} />
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="results" role="listbox">
      {s.groups.map((g) => (
        <section key={g.key} className="group">
          {(g.title || g.loading || (g.error && g.error !== "notconfigured")) && (
            <div className="group-title">
              {g.source && s.source === "all" && <SourceTile id={g.source} size={14} />}
              <span>{g.title ?? (g.loading ? "Recherche en direct…" : "")}</span>
              {g.loading && <LoaderCircle size={12} className="spin" />}
              {g.error && g.error !== "notconfigured" && (
                <span className="group-error" title={g.error}>
                  <TriangleAlert size={12} /> {g.error}
                </span>
              )}
            </div>
          )}
          {g.items.map((it) => (
            <Row key={itemKey(it)} item={it} selected={itemKey(it) === selKey} tokens={tokens} />
          ))}
          {g.hint && (
            <div className="hint-card">
              <Plug size={16} />
              <p>{g.hint}</p>
              {g.hintTab && (
                <button className="btn" onClick={() => openSettings(g.hintTab)}>
                  Connecter
                </button>
              )}
            </div>
          )}
          {g.loading && !g.items.length && (
            <div className="skeleton">
              <span />
              <span />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function ContactList({ list }: { list: ContactInfo[] }) {
  if (!list.length) return null;
  return (
    <section className="pv-contacts">
      <div className="pv-section-title">Coordonnées</div>
      {list.map((c, i) => (
        <div key={`${c.kind}-${c.value}-${i}`} className={`contact-row contact-${c.kind}`}>
          <button
            className="contact-main"
            title={c.kind === "phone" ? `Appeler ${c.value}` : `Écrire à ${c.value}`}
            onClick={() => void openContact(c)}
          >
            <span className="contact-icon">{c.kind === "phone" ? <Phone size={14} /> : <Mail size={14} />}</span>
            <span className="contact-text">
              <span className="contact-value">{c.value}</span>
              {(c.label || c.who) && <span className="contact-label">{[c.who, c.label].filter(Boolean).join(" · ")}</span>}
            </span>
          </button>
          <button
            className="contact-copy"
            title="Copier"
            onClick={() => void copyText(c.value, c.kind === "phone" ? "Numéro" : "E-mail")}
          >
            <Copy size={13} />
          </button>
        </div>
      ))}
    </section>
  );
}

function Preview() {
  const s = useStore(ui);
  useStore(settingsStore);
  const items = flatItems(s.groups);
  const item = items.find((i) => itemKey(i) === s.selectedKey) ?? items[0];
  if (!item) return <aside className="preview" />;
  const src = SOURCES[item.source];
  const inApp = willOpenInApp(item);
  if (item.action === "switch") {
    return (
      <aside className="preview">
        <div className="pv-head">
          <SourceTile id={item.source} size={34} />
          <div className="pv-title">{item.title}</div>
        </div>
        <p className="pv-note">Relance la recherche uniquement dans {src.label}, avec ses filtres et son autocomplétion.</p>
      </aside>
    );
  }
  if (item.action === "native") {
    return (
      <aside className="preview">
        <div className="pv-head">
          <SourceTile id={item.source} size={34} />
          <div className="pv-title">{item.title}</div>
        </div>
        <p className="pv-note">Ouvre la recherche native de l'outil avec la même requête.</p>
        {item.snippet && <p className="pv-note strong">{item.snippet}</p>}
        <div className="pv-actions">
          <button className="btn primary" onClick={() => void runNative(item.source)}>
            Lancer <kbd>⇧↵</kbd>
          </button>
          {src.extraNative?.(parseQuery(s.query, src)).map((t) => (
            <button key={t.label} className="btn" onClick={() => void runNative(item.source, t)}>
              {t.label} <ArrowUpRight size={13} />
            </button>
          ))}
        </div>
      </aside>
    );
  }
  const d = src.describe(item);
  const rows = src.details(item);
  return (
    <aside className="preview preview-split">
      <div className="pv-scroll">
      <div className="pv-head">
        <span className="pv-icon" style={{ ["--kind" as string]: kindColor(item) }}>
          <ItemIcon item={item} size={24} />
        </span>
        <div>
          <div className="pv-title">{item.title}</div>
          <div className="pv-src">
            <SourceTile id={item.source} size={14} /> {src.label}
            {d.badge && <span className={`badge tone-${d.badgeTone ?? "gray"}`}>{d.badge}</span>}
          </div>
        </div>
      </div>
      {item.snippet && <p className="pv-snippet">{item.snippet}</p>}
      <ContactList list={src.contacts?.(item) ?? []} />
      <dl className="pv-details">
        {rows.map((r) => (
          <div key={r.label} className="pv-row">
            <dt>{r.label}</dt>
            <dd title={r.value}>{r.value}</dd>
          </div>
        ))}
      </dl>
      </div>
      <div className="pv-actions">
        <button className="btn primary" onClick={() => void openItem(item)}>
          {inApp ? <AppWindow size={14} /> : <Globe size={14} />}
          {item.action === "ask" ? "Envoyer" : inApp ? `Ouvrir dans ${src.appTarget?.name}` : "Ouvrir"} <kbd>↵</kbd>
        </button>
        {item.app && src.appTarget && (
          <button className="btn" onClick={() => void openItem(item, { web: true })}>
            <Globe size={14} /> Navigateur <kbd>Ctrl+↵</kbd>
          </button>
        )}
        {item.action !== "ask" && (
          <button className="btn" onClick={() => void copyLink(item)}>
            <Copy size={14} /> Copier le lien
          </button>
        )}
        {src.secondaryActions?.(item).map((a) => (
          <button key={a.label} className="btn" onClick={() => void a.run()}>
            {a.label}
          </button>
        ))}
      </div>
    </aside>
  );
}

function Footer() {
  const s = useStore(ui);
  const src = sourceDef(s.source);
  const items = flatItems(s.groups);
  const item = items.find((i) => itemKey(i) === s.selectedKey) ?? items[0];
  const inApp = item ? willOpenInApp(item) : false;
  return (
    <footer className="footer">
      <span>
        <kbd>↵</kbd>{" "}
        {item?.action === "switch"
          ? "Voir"
          : item?.action === "ask"
            ? "Envoyer"
            : inApp
              ? `Ouvrir dans ${item ? SOURCES[item.source].appTarget?.name : ""}`
              : "Ouvrir"}
      </span>
      <span>
        <kbd>Ctrl+↵</kbd> Navigateur
      </span>
      {src && !src.actions && (
        <span>
          <kbd>⇧↵</kbd> Rechercher dans {src.label}
        </span>
      )}
      <span>
        <kbd>Tab</kbd> Compléter
      </span>
      <span>
        <kbd>Alt+1…7</kbd> Outil
      </span>
      <span className="grow" />
      <span className="status">
        {s.liveLoading ? "Recherche en direct…" : s.liveMs !== null && s.query ? `En direct · ${s.liveMs} ms` : `${items.filter((i) => !i.action).length} résultats`}
      </span>
    </footer>
  );
}

export function SearchView() {
  return (
    <div className="view search-view">
      <header className="top" onMouseDown={dragHandle}>
        <SourcePills />
        <TopActions />
      </header>
      <SearchBar />
      {ui.get().source === "drive" && <DriveShortcuts />}
      <FilterBar />
      <div className="body">
        <Results />
        <Preview />
      </div>
      <Footer />
    </div>
  );
}
