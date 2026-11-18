import {
  ArrowRight,
  Search as SearchIcon,
  Asterisk,
  Briefcase,
  Building2,
  ClipboardList,
  Database,
  ExternalLink,
  File,
  FileText,
  FileType,
  Folder,
  Image as ImageIcon,
  Mail,
  MessagesSquare,
  Package,
  Presentation,
  Sheet,
  Sparkles,
  Target,
  User,
  Video,
  Globe,
} from "lucide-react";
import type { JSX, ReactNode } from "react";
import type { ResultItem, SourceId } from "../sources/types";

const YATEO_PATHS = (
  <>
    <path
      transform="translate(-19.214 -7.549)"
      d="M43.626,12.967c.051-.011.057.023.06.06a12.591,12.591,0,0,1,2.639,6.882,13.816,13.816,0,0,1-1.56,7.659,13.347,13.347,0,0,1-11.757,7.121c-.053-.2.2-.375.3-.479a34.079,34.079,0,0,0,6.6-8.617,43.3,43.3,0,0,0,3.719-12.626"
    />
    <path
      transform="translate(0 -10.46)"
      d="M1.448,17.965a17.641,17.641,0,0,0,6.216,5.454c1.12.6,2.6,1.142,4,1.778,1.255.57,2.881,1.4,3.228,2.55.514,1.708-.468,4.38-1.016,5.632a11.206,11.206,0,0,1-1.255,2.193c-.388.528-1.094,1.521-1.793,1.6a7.682,7.682,0,0,1-2.988-.949A13.255,13.255,0,0,1,.013,24.546a13.784,13.784,0,0,1,1.434-6.581"
    />
    <path
      transform="translate(-4.161 0)"
      d="M27.494,3.935a23.807,23.807,0,0,1-4,4.007A10.6,10.6,0,0,1,17.926,10.4,12.743,12.743,0,0,1,8.842,7.584c-.546-.457-1.715-1.542-1.7-2.213C7.16,4.89,8.413,3.834,8.9,3.4A13.454,13.454,0,0,1,16.836.047,13.218,13.218,0,0,1,27.494,3.935"
    />
  </>
);

/** Logo Shorteo : une loupe dont le verre est le symbole YATEO (couleur héritée du texte). */
export function ShorteoLogo({ size = 20, className = "yateo-logo" }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 40 40" aria-label="Shorteo" role="img">
      <g fill="var(--yateo-red)" transform="translate(1.422 1.429)">
        {YATEO_PATHS}
      </g>
      <line x1="25.4" y1="25.4" x2="35.2" y2="35.2" stroke="currentColor" strokeWidth="5.6" strokeLinecap="round" />
    </svg>
  );
}

/** Pastille colorée représentant un outil (pictogrammes génériques). */
export function SourceTile({ id, size = 22 }: { id: SourceId; size?: number }) {
  const s = Math.round(size * 0.6);
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.28) };
  switch (id) {
    case "all":
      return (
        <span className="tile tile-all" style={style}>
          <ShorteoLogo size={Math.round(size * 0.74)} className="tile-logo" />
        </span>
      );
    case "notion":
      return (
        <span className="tile tile-notion" style={style}>
          <span style={{ fontSize: size * 0.62, fontWeight: 700, fontFamily: "Georgia, 'Times New Roman', serif" }}>N</span>
        </span>
      );
    case "drive":
      return (
        <span className="tile tile-drive" style={style}>
          <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
            <path d="M8.2 3h7.6l6.2 10.7-3.8 6.6L12 9.6z" fill="#fbbc04" />
            <path d="M8.2 3 2 13.7l3.8 6.6L12 9.6z" fill="#34a853" />
            <path d="M5.8 20.3h12.4l3.8-6.6H9.6z" fill="#4285f4" />
          </svg>
        </span>
      );
    case "pipedrive":
      return (
        <span className="tile tile-pipedrive" style={style}>
          <span style={{ fontSize: size * 0.6, fontWeight: 800 }}>P</span>
        </span>
      );
    case "mail":
      return (
        <span className="tile tile-mail" style={style}>
          <Mail size={s} strokeWidth={2.2} />
        </span>
      );
    case "chatgpt":
      return (
        <span className="tile tile-chatgpt" style={style}>
          <Sparkles size={s} strokeWidth={2.2} />
        </span>
      );
    case "claude":
      return (
        <span className="tile tile-claude" style={style}>
          <Asterisk size={s} strokeWidth={2.8} />
        </span>
      );
  }
}

const KIND_ICONS: Record<string, { Icon: typeof File; color: string }> = {
  page: { Icon: FileText, color: "var(--muted)" },
  database: { Icon: Database, color: "#a78bfa" },
  doc: { Icon: FileText, color: "#4285f4" },
  sheet: { Icon: Sheet, color: "#1fa463" },
  slides: { Icon: Presentation, color: "#f4b400" },
  pdf: { Icon: FileType, color: "#ea4335" },
  folder: { Icon: Folder, color: "#8ab4f8" },
  form: { Icon: ClipboardList, color: "#7e57c2" },
  image: { Icon: ImageIcon, color: "#f06292" },
  video: { Icon: Video, color: "#ef5350" },
  file: { Icon: File, color: "var(--muted)" },
  deal: { Icon: Briefcase, color: "#22c55e" },
  person: { Icon: User, color: "#a78bfa" },
  organization: { Icon: Building2, color: "#f59e0b" },
  lead: { Icon: Target, color: "#10b981" },
  product: { Icon: Package, color: "#94a3b8" },
  thread: { Icon: Mail, color: "#8b5cf6" },
  conversation: { Icon: MessagesSquare, color: "var(--muted)" },
  "ask-web": { Icon: Globe, color: "#10a37f" },
  native: { Icon: ExternalLink, color: "var(--accent)" },
  switch: { Icon: ArrowRight, color: "var(--muted)" },
};

/** Couleur associée au type d'élément (fond teinté de la pastille d'icône). */
export function kindColor(item: ResultItem): string {
  if (item.kind === "ask" || item.kind === "ask-web") return item.source === "claude" ? "#e07a55" : "#10a37f";
  if (item.kind === "native" || item.kind === "switch") return "var(--tool)";
  const c = KIND_ICONS[item.kind]?.color;
  return !c || c.startsWith("var(") ? "#9aa0ab" : c;
}

export function ItemIcon({ item, size = 18 }: { item: ResultItem; size?: number }) {
  if (item.kind === "ask") return <SourceTile id={item.source} size={size + 4} />;
  if (item.icon) return <span className="emoji" style={{ fontSize: size - 1 }}>{item.icon}</span>;
  const k = KIND_ICONS[item.kind] ?? KIND_ICONS.file;
  return <k.Icon size={size} color={k.color} strokeWidth={1.9} />;
}

// ---------------------------------------------------------------------------
// Icône d'un résultat : le logo de l'outil où il a été trouvé (grand) + une petite
// pastille dans le coin pour le type (Docs, Sheets, Slides, affaire, entreprise…).
// ---------------------------------------------------------------------------

/** Page de type Google (Docs, Sheets, Slides…) : coin plié + motif blanc. */
function PageGlyph({ color, size, children }: { color: string; size: number; children?: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path d="M3.5 1h6.2L13 4.3v9.2a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 2 13.5v-11A1.5 1.5 0 0 1 3.5 1z" fill={color} />
      <path d="M9.7 1 13 4.3h-2.3a1 1 0 0 1-1-1z" fill="#fff" opacity=".45" />
      {children}
    </svg>
  );
}

const W = "#fff";
const FILE_GLYPHS: Record<string, (size: number) => JSX.Element> = {
  doc: (s) => (
    <PageGlyph color="#4285f4" size={s}>
      <path d="M4.6 7.2h6.8M4.6 9.4h6.8M4.6 11.6h4.4" stroke={W} strokeWidth="1.2" strokeLinecap="round" />
    </PageGlyph>
  ),
  sheet: (s) => (
    <PageGlyph color="#0f9d58" size={s}>
      <rect x="4.4" y="6.6" width="7.2" height="5.6" rx=".6" fill="none" stroke={W} strokeWidth="1.1" />
      <path d="M4.4 9.4h7.2M8 6.6v5.6" stroke={W} strokeWidth="1.1" />
    </PageGlyph>
  ),
  slides: (s) => (
    <PageGlyph color="#f4b400" size={s}>
      <rect x="4.4" y="7" width="7.2" height="4.6" rx=".7" fill="none" stroke={W} strokeWidth="1.2" />
    </PageGlyph>
  ),
  form: (s) => (
    <PageGlyph color="#7248b9" size={s}>
      <circle cx="5.2" cy="7.6" r=".8" fill={W} />
      <circle cx="5.2" cy="10.6" r=".8" fill={W} />
      <path d="M7.2 7.6h4.2M7.2 10.6h4.2" stroke={W} strokeWidth="1.2" strokeLinecap="round" />
    </PageGlyph>
  ),
  pdf: (s) => (
    <PageGlyph color="#ea4335" size={s}>
      <path d="M5 11.8c1.6-1.2 2.8-3.2 3.1-5.2.1-.8-1-.9-1-.1 0 2 2.2 4.2 3.9 4.6.8.2.9-.8.1-.9-1.9-.2-4.6.5-6.1 1.6z" fill="none" stroke={W} strokeWidth="1" strokeLinejoin="round" />
    </PageGlyph>
  ),
  image: (s) => (
    <PageGlyph color="#d93f7e" size={s}>
      <path d="M4.4 12l2.4-3 1.7 2 1.2-1.4 1.9 2.4z" fill={W} />
      <circle cx="10.2" cy="7.2" r=".9" fill={W} />
    </PageGlyph>
  ),
  video: (s) => (
    <PageGlyph color="#e53935" size={s}>
      <path d="M6.6 7v5l4-2.5z" fill={W} />
    </PageGlyph>
  ),
  file: (s) => <PageGlyph color="#8a9099" size={s} />,
  folder: (s) => (
    <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden>
      <path d="M1.5 4.2A1.2 1.2 0 0 1 2.7 3h3.4l1.4 1.5h5.8a1.2 1.2 0 0 1 1.2 1.2v6.6a1.2 1.2 0 0 1-1.2 1.2H2.7a1.2 1.2 0 0 1-1.2-1.2z" fill="#8a9099" />
      <path d="M1.5 6.2h13v6.1a1.2 1.2 0 0 1-1.2 1.2H2.7a1.2 1.2 0 0 1-1.2-1.2z" fill="#a6acb5" />
    </svg>
  ),
};

/** Pastille de type pour Pipedrive, Notion (base), actions… : pictogramme sur fond coloré. */
const KIND_BADGES: Record<string, { Icon: typeof File; bg: string }> = {
  deal: { Icon: Briefcase, bg: "#16a34a" },
  person: { Icon: User, bg: "#7c4dea" },
  organization: { Icon: Building2, bg: "#e08a00" },
  lead: { Icon: Target, bg: "#0d9488" },
  product: { Icon: Package, bg: "#64748b" },
  database: { Icon: Database, bg: "#7c4dea" },
  native: { Icon: SearchIcon, bg: "var(--tool)" },
  switch: { Icon: ArrowRight, bg: "var(--tool)" },
  "ask-web": { Icon: Globe, bg: "#2563eb" },
};

function Badge({ item, size }: { item: ResultItem; size: number }) {
  // lignes d'action (rechercher dans l'outil, voir tout…) : pictogramme de l'action
  const action = item.kind === "native" || item.kind === "switch" || item.kind === "ask-web" ? KIND_BADGES[item.kind] : null;
  if (action) {
    return (
      <span className="rbadge" style={{ width: size, height: size, background: action.bg }}>
        <action.Icon size={size * 0.62} strokeWidth={2.6} color="#fff" />
      </span>
    );
  }
  // Notion : l'emoji de la page
  if (item.icon) {
    return (
      <span className="rbadge rbadge-emoji" style={{ width: size, height: size, fontSize: size * 0.78 }}>
        {item.icon}
      </span>
    );
  }
  if (item.source === "drive") {
    const g = FILE_GLYPHS[item.kind] ?? FILE_GLYPHS.file;
    return <span className="rbadge rbadge-file">{g(size)}</span>;
  }
  const b = KIND_BADGES[item.kind];
  if (!b) return null;
  return (
    <span className="rbadge" style={{ width: size, height: size, background: b.bg }}>
      <b.Icon size={size * 0.62} strokeWidth={2.6} color="#fff" />
    </span>
  );
}

/** Icône d'un résultat : logo de l'outil + type dans le coin. */
export function ResultIcon({ item, size = 30 }: { item: ResultItem; size?: number }) {
  return (
    <span className="ricon" style={{ width: size, height: size }}>
      <SourceTile id={item.source} size={size} />
      <Badge item={item} size={Math.round(size * 0.52)} />
    </span>
  );
}

/** Pictogramme d'un fichier Drive (Docs, Sheets, Slides, dossier…). */
export function FileGlyph({ kind, size = 16 }: { kind: string; size?: number }) {
  return (FILE_GLYPHS[kind] ?? FILE_GLYPHS.file)(size);
}
