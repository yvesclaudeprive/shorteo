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
  Search,
  Sheet,
  Sparkles,
  Target,
  User,
  Video,
  Globe,
} from "lucide-react";
import type { ResultItem, SourceId } from "../sources/types";

/** Pastille colorée représentant un outil (pictogrammes génériques). */
export function SourceTile({ id, size = 22 }: { id: SourceId; size?: number }) {
  const s = Math.round(size * 0.6);
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.28) };
  switch (id) {
    case "all":
      return (
        <span className="tile tile-all" style={style}>
          <Search size={s} strokeWidth={2.4} />
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

export function ItemIcon({ item, size = 18 }: { item: ResultItem; size?: number }) {
  if (item.kind === "ask") return <SourceTile id={item.source} size={size + 4} />;
  if (item.icon) return <span className="emoji" style={{ fontSize: size - 1 }}>{item.icon}</span>;
  const k = KIND_ICONS[item.kind] ?? KIND_ICONS.file;
  return <k.Icon size={size} color={k.color} strokeWidth={1.9} />;
}
