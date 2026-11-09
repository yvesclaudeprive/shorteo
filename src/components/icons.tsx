import {
  ArrowRight,
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

/** Logo Shorteo : une loupe dont le verre est le symbole Yateo (couleur héritée du texte). */
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
