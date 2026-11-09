import { useEffect, useState, type ReactNode, type KeyboardEvent } from "react";
import {
  ArrowLeft,
  Check,
  Database,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Power,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { useStore } from "../app/store";
import { settingsStore, updateSettings, saveSettingsNow, type OpenMode } from "../app/settings";
import { closeSettings, errorText, syncAll, toast, ui } from "../app/controller";
import { clearAllIndexes, getIndex, indexVersion, setIndex } from "../app/index-store";
import { deleteSecret, getSecret, setSecret } from "../app/secrets";
import { platform } from "../app/platform";
import { fullDate, relativeDate } from "../app/format";
import { testNotion } from "../sources/notion";
import { testPipedrive } from "../sources/pipedrive";
import { connectGoogle, disconnectGoogle, gapi } from "../sources/google";
import { superhumanLinks } from "../sources/mail";
import { importHistory } from "../sources/ai";
import type { SourceId } from "../sources/types";
import { SourceTile } from "./icons";

const TABS: Array<{ id: string; label: string; tile?: SourceId; icon?: typeof Database }> = [
  { id: "welcome", label: "Bienvenue", icon: Sparkles },
  { id: "general", label: "Général", icon: SlidersHorizontal },
  { id: "notion", label: "Notion", tile: "notion" },
  { id: "pipedrive", label: "Pipedrive", tile: "pipedrive" },
  { id: "google", label: "Drive & Mails", tile: "drive" },
  { id: "superhuman", label: "Superhuman", tile: "mail" },
  { id: "ai", label: "ChatGPT & Claude", tile: "claude" },
  { id: "index", label: "Index & données", icon: Database },
];

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        void platform.openUrl(href);
      }}
    >
      {children}
      <ExternalLink size={11} />
    </a>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="field-control">{children}</div>
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`toggle ${checked ? "on" : ""}`} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

function OpenModeSelect({ value, onChange, app }: { value: OpenMode; onChange: (v: OpenMode) => void; app: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as OpenMode)}>
      <option value="app-if-running">App {app} si elle est ouverte, sinon navigateur</option>
      <option value="app-if-installed">App {app} si elle est installée, sinon navigateur</option>
      <option value="browser">Toujours le navigateur</option>
    </select>
  );
}

function useSecretPresent(key: string): [boolean, () => void] {
  const [present, setPresent] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    void getSecret(key).then((v) => setPresent(!!v));
  }, [key, n]);
  return [present, () => setN((x) => x + 1)];
}

function SecretInput({
  label,
  secretKey,
  placeholder,
  onSave,
}: {
  label: string;
  secretKey: string;
  placeholder: string;
  onSave: () => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [present, refresh] = useSecretPresent(secretKey);
  const save = async () => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await setSecret(secretKey, value.trim());
      setValue("");
      refresh();
      await onSave();
    } catch (e) {
      toast(errorText(e), "error", 6000);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Field
      label={label}
      hint={present ? <span className="ok"><Check size={12} /> Enregistrée dans le coffre-fort Windows</span> : "Stockée dans le coffre-fort Windows, jamais dans un fichier."}
    >
      <div className="inline">
        <input
          type="password"
          value={value}
          placeholder={present ? "•••••••• (déjà enregistrée — collez pour remplacer)" : placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
        />
        <button className="btn primary" disabled={busy || !value.trim()} onClick={() => void save()}>
          {busy ? <LoaderCircle size={14} className="spin" /> : <KeyRound size={14} />} Enregistrer
        </button>
      </div>
    </Field>
  );
}

function Status({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <div className={`status-line ${ok ? "ok" : "off"}`}>{children}</div>;
}

// ---------------------------------------------------------------------------

function Welcome() {
  return (
    <div className="tab">
      <h2>Bienvenue dans Yateo Search 👋</h2>
      <p className="lead">
        Une fenêtre, un raccourci, toutes vos recherches : Notion, Google Drive, Pipedrive, vos mails (ouverts dans
        Superhuman), ChatGPT et Claude.
      </p>
      <ol className="steps">
        <li>
          <b>Raccourci</b> : par défaut <kbd>Ctrl+Maj+Espace</kbd>. Modifiable dans <a onClick={() => ui.set({ settingsTab: "general" })}>Général</a>.
        </li>
        <li>
          <b>Connectez vos outils</b> (5 minutes chacun, guide pas à pas) :{" "}
          <a onClick={() => ui.set({ settingsTab: "notion" })}>Notion</a>,{" "}
          <a onClick={() => ui.set({ settingsTab: "pipedrive" })}>Pipedrive</a>,{" "}
          <a onClick={() => ui.set({ settingsTab: "google" })}>Drive & Mails</a>.
        </li>
        <li>
          <b>Vérifiez l'ouverture dans Superhuman</b> : <a onClick={() => ui.set({ settingsTab: "superhuman" })}>tester le lien</a>.
        </li>
        <li>
          <b>Facultatif</b> : importez votre historique <a onClick={() => ui.set({ settingsTab: "ai" })}>ChatGPT et Claude</a>.
        </li>
      </ol>
      <p className="muted small">
        Vos clés restent sur ce PC (coffre-fort Windows). L'index local ne contient que des titres et des métadonnées,
        mis à jour en arrière-plan ; chaque recherche interroge aussi les outils en direct.
      </p>
    </div>
  );
}

function shortcutFromEvent(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  const code = e.code;
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^F\d{1,2}$/.test(code)) key = code;
  else if (code === "Space") key = "Space";
  if (!key || !mods.length) return null;
  return [...mods, key].join("+");
}

function General() {
  const st = useStore(settingsStore);
  const [capturing, setCapturing] = useState(false);
  const [autostart, setAutostart] = useState(false);
  useEffect(() => {
    void platform.autostartEnabled().then(setAutostart).catch(() => {});
  }, []);
  const applyShortcut = async (sc: string) => {
    try {
      await platform.setShortcut(sc);
      updateSettings({ shortcut: sc });
      toast(`Raccourci : ${sc}`, "success");
    } catch (e) {
      toast(errorText(e), "error", 6000);
    }
  };
  return (
    <div className="tab">
      <h2>Général</h2>
      <Field label="Raccourci global" hint="Cliquez puis appuyez sur la combinaison voulue (au moins Ctrl, Alt ou Maj). Évitez Alt+Espace, déjà utilisé par ChatGPT.">
        <input
          readOnly
          className={`shortcut ${capturing ? "capturing" : ""}`}
          value={capturing ? "Appuyez sur la combinaison…" : st.shortcut.replace("Shift", "Maj").replace("Space", "Espace")}
          onFocus={() => setCapturing(true)}
          onBlur={() => setCapturing(false)}
          onKeyDown={(e) => {
            e.preventDefault();
            const sc = shortcutFromEvent(e);
            if (sc) {
              setCapturing(false);
              (e.target as HTMLInputElement).blur();
              void applyShortcut(sc);
            }
          }}
        />
      </Field>
      <Field label="Thème">
        <select value={st.theme} onChange={(e) => updateSettings({ theme: e.target.value as typeof st.theme })}>
          <option value="auto">Automatique (comme Windows)</option>
          <option value="dark">Sombre</option>
          <option value="light">Clair</option>
        </select>
      </Field>
      <Field label="Masquer la fenêtre quand je clique ailleurs">
        <Toggle checked={st.hideOnBlur} onChange={(v) => updateSettings({ hideOnBlur: v })} />
      </Field>
      <Field label="Lancer au démarrage de Windows">
        <Toggle
          checked={autostart}
          onChange={(v) => {
            setAutostart(v);
            void platform.setAutostart(v).catch((e) => toast(errorText(e), "error"));
          }}
        />
      </Field>
      <Field label="Fréquence de mise à jour de l'index">
        <select value={st.syncMinutes} onChange={(e) => updateSettings({ syncMinutes: Number(e.target.value) })}>
          <option value={1}>Toutes les minutes</option>
          <option value={2}>Toutes les 2 minutes</option>
          <option value={5}>Toutes les 5 minutes</option>
          <option value={15}>Toutes les 15 minutes</option>
        </select>
      </Field>
      <div className="danger-zone">
        <button className="btn" onClick={() => void platform.quit()}>
          <Power size={14} /> Quitter Yateo Search
        </button>
      </div>
    </div>
  );
}

function NotionTab() {
  const st = useStore(settingsStore);
  const connect = async () => {
    const msg = await testNotion();
    updateSettings({ connected: { ...st.connected, notion: true } });
    toast(msg, "success");
    void syncAll(true);
  };
  return (
    <div className="tab">
      <h2>
        <SourceTile id="notion" size={22} /> Notion
      </h2>
      <Status ok={st.connected.notion}>{st.connected.notion ? "Connecté" : "Non connecté"}</Status>
      <ol className="steps">
        <li>
          Ouvrez <Link href="https://www.notion.so/profile/integrations">notion.so/profile/integrations</Link> →{" "}
          <b>Nouvelle intégration</b> (type <b>Interne</b>, nom « Yateo Search »).
        </li>
        <li>
          Capacités : cochez <b>Lire le contenu</b> et <b>Lire les informations des utilisateurs</b>.
        </li>
        <li>
          Copiez le <b>secret d'intégration interne</b> et collez-le ci-dessous.
        </li>
        <li>
          Dans Notion, sur chaque page principale à rendre cherchable : <b>•••</b> → <b>Connexions</b> → ajoutez « Yateo Search ».
          Les sous-pages suivent automatiquement.
        </li>
      </ol>
      <SecretInput label="Secret d'intégration" secretKey="notion_token" placeholder="ntn_…" onSave={connect} />
      <Field label="Au clic sur un résultat">
        <OpenModeSelect app="Notion" value={st.notionOpen} onChange={(v) => updateSettings({ notionOpen: v })} />
      </Field>
      <Field
        label="Lien de recherche Notion (avancé)"
        hint="Laissez vide : Yateo Search ouvre Notion et copie la requête (Ctrl+K puis Ctrl+V). Variable disponible : {q}"
      >
        <input value={st.notionSearchUrl} placeholder="(vide)" onChange={(e) => updateSettings({ notionSearchUrl: e.target.value })} />
      </Field>
      {st.connected.notion && (
        <div className="row-buttons">
          <button className="btn" onClick={() => void connect().catch((e) => toast(errorText(e), "error", 6000))}>
            <RefreshCw size={14} /> Tester et resynchroniser
          </button>
          <button
            className="btn"
            onClick={async () => {
              await deleteSecret("notion_token");
              updateSettings({ connected: { ...st.connected, notion: false } });
              setIndex("notion", [], {});
            }}
          >
            Déconnecter
          </button>
        </div>
      )}
    </div>
  );
}

function PipedriveTab() {
  const st = useStore(settingsStore);
  const connect = async () => {
    await saveSettingsNow();
    const msg = await testPipedrive();
    updateSettings({ connected: { ...st.connected, pipedrive: true } });
    toast(msg, "success");
    void syncAll(true);
  };
  return (
    <div className="tab">
      <h2>
        <SourceTile id="pipedrive" size={22} /> Pipedrive
      </h2>
      <Status ok={st.connected.pipedrive}>{st.connected.pipedrive ? "Connecté" : "Non connecté"}</Status>
      <ol className="steps">
        <li>
          <b>Domaine</b> : la partie avant « .pipedrive.com » dans l'adresse de votre Pipedrive.
        </li>
        <li>
          <b>Jeton API</b> : dans Pipedrive, cliquez sur votre photo → <b>Préférences personnelles</b> → onglet <b>API</b> → copiez le jeton.
        </li>
      </ol>
      <Field label="Domaine Pipedrive">
        <div className="inline">
          <input
            value={st.pipedriveDomain}
            placeholder="votre-societe"
            onChange={(e) => updateSettings({ pipedriveDomain: e.target.value.trim() })}
          />
          <span className="suffix">.pipedrive.com</span>
        </div>
      </Field>
      <SecretInput label="Jeton API personnel" secretKey="pipedrive_token" placeholder="Collez votre jeton API" onSave={connect} />
      <Field
        label="Lien de recherche Pipedrive (avancé)"
        hint="Pipedrive n'a pas de lien de recherche officiel : par défaut, Yateo Search ouvre Pipedrive et copie la requête. Variable : {q}"
      >
        <input value={st.pipedriveSearchUrl} placeholder="(vide)" onChange={(e) => updateSettings({ pipedriveSearchUrl: e.target.value })} />
      </Field>
      {st.connected.pipedrive && (
        <div className="row-buttons">
          <button className="btn" onClick={() => void connect().catch((e) => toast(errorText(e), "error", 6000))}>
            <RefreshCw size={14} /> Tester et resynchroniser
          </button>
          <button
            className="btn"
            onClick={async () => {
              await deleteSecret("pipedrive_token");
              updateSettings({ connected: { ...st.connected, pipedrive: false } });
              setIndex("pipedrive", [], {});
            }}
          >
            Déconnecter
          </button>
        </div>
      )}
    </div>
  );
}

function GoogleTab() {
  const st = useStore(settingsStore);
  const [cid, setCid] = useState("");
  const [secret, setSecretValue] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void getSecret("google_client_id").then((v) => v && setCid(v));
  }, []);
  const connect = async () => {
    const storedSecret = secret || (await getSecret("google_client_secret")) || "";
    if (!cid.trim() || !storedSecret.trim()) {
      toast("Renseignez l'ID client et le code secret", "error");
      return;
    }
    setBusy(true);
    try {
      toast("Validez l'accès dans votre navigateur…", "info", 8000);
      const email = await connectGoogle(cid, storedSecret);
      updateSettings({ connected: { ...st.connected, google: true }, mailAccount: email });
      setSecretValue("");
      toast(`Connecté : ${email}`, "success");
      void syncAll(true);
    } catch (e) {
      toast(errorText(e), "error", 8000);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tab">
      <h2>
        <SourceTile id="drive" size={22} /> Google Drive & Mails (Gmail)
      </h2>
      <Status ok={st.connected.google}>{st.connected.google ? `Connecté : ${st.mailAccount}` : "Non connecté"}</Status>
      <ol className="steps">
        <li>
          Créez un projet : <Link href="https://console.cloud.google.com/projectcreate">console.cloud.google.com</Link> (nom « Yateo Search »).
        </li>
        <li>
          Activez les 3 API (bouton « Activer ») :{" "}
          <Link href="https://console.cloud.google.com/apis/library/drive.googleapis.com">Drive</Link>,{" "}
          <Link href="https://console.cloud.google.com/apis/library/gmail.googleapis.com">Gmail</Link>,{" "}
          <Link href="https://console.cloud.google.com/apis/library/people.googleapis.com">People (contacts)</Link>.
        </li>
        <li>
          <Link href="https://console.cloud.google.com/auth/overview">Écran de consentement</Link> : type d'utilisateur <b>Interne</b>{" "}
          (aucune validation Google nécessaire).
        </li>
        <li>
          <Link href="https://console.cloud.google.com/auth/clients">Clients</Link> → <b>Créer un client</b> → type{" "}
          <b>Application de bureau</b> → copiez l'<b>ID client</b> et le <b>code secret</b>.
        </li>
        <li>Collez-les ci-dessous, puis « Se connecter avec Google » et acceptez (lecture seule).</li>
      </ol>
      <Field label="ID client">
        <input value={cid} placeholder="xxxxxxxx.apps.googleusercontent.com" onChange={(e) => setCid(e.target.value)} />
      </Field>
      <Field label="Code secret du client" hint="Stocké dans le coffre-fort Windows.">
        <input type="password" value={secret} placeholder="GOCSPX-… (laisser vide si déjà enregistré)" onChange={(e) => setSecretValue(e.target.value)} />
      </Field>
      <div className="row-buttons">
        <button className="btn primary" disabled={busy} onClick={() => void connect()}>
          {busy ? <LoaderCircle size={14} className="spin" /> : <KeyRound size={14} />}
          {st.connected.google ? "Reconnecter Google" : "Se connecter avec Google"}
        </button>
        {st.connected.google && (
          <button
            className="btn"
            onClick={async () => {
              await disconnectGoogle();
              updateSettings({ connected: { ...st.connected, google: false } });
              setIndex("drive", [], {});
            }}
          >
            Déconnecter
          </button>
        )}
      </div>
      <Field label="Nombre maximum de fichiers Drive indexés">
        <select value={st.driveMaxItems} onChange={(e) => updateSettings({ driveMaxItems: Number(e.target.value) })}>
          <option value={20000}>20 000</option>
          <option value={60000}>60 000</option>
          <option value={150000}>150 000</option>
        </select>
      </Field>
    </div>
  );
}

function SuperhumanTab() {
  const st = useStore(settingsStore);
  const [testing, setTesting] = useState(false);
  const test = async () => {
    setTesting(true);
    try {
      const res = await gapi<any>("https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=1&q=in:inbox");
      const id = res.threads?.[0]?.id;
      if (!id) throw new Error("Aucun mail dans la boîte de réception");
      const links = superhumanLinks(id);
      const s = await platform.appsStatus(["Superhuman.exe"], ["superhuman"]);
      const useApp = st.superhumanOpen !== "browser" && links.app && (s.running["Superhuman.exe"] || (st.superhumanOpen === "app-if-installed" && s.installed.superhuman));
      await platform.openUrl(useApp ? links.app! : links.url);
      toast(`Ouverture du dernier mail reçu ${useApp ? "dans l'app" : "dans le navigateur"}…`, "info", 5000);
    } catch (e) {
      toast(errorText(e), "error", 6000);
    } finally {
      setTesting(false);
    }
  };
  return (
    <div className="tab">
      <h2>
        <SourceTile id="mail" size={22} /> Superhuman
      </h2>
      <p className="lead small">
        La recherche de mails passe par Gmail (mêmes opérateurs : <code>de:</code>, <code>à:</code>, <code>objet:</code>,{" "}
        <code>avec:pj</code>, <code>après:</code>…). Au clic, le fil s'ouvre dans Superhuman.
      </p>
      <Field label="Au clic sur un mail">
        <OpenModeSelect app="Superhuman" value={st.superhumanOpen} onChange={(v) => updateSettings({ superhumanOpen: v })} />
      </Field>
      <Field
        label="Lien vers un fil Superhuman"
        hint={
          <>
            Variables : <code>{"{email}"}</code> <code>{"{threadId}"}</code>. Pour vérifier : ouvrez un mail sur mail.superhuman.com,
            copiez l'adresse de la page et comparez. L'app est ouverte via <code>superhuman://</code> + le même chemin.
          </>
        }
      >
        <input value={st.superhumanThreadUrl} onChange={(e) => updateSettings({ superhumanThreadUrl: e.target.value })} />
      </Field>
      <div className="row-buttons">
        <button className="btn" disabled={testing || !st.connected.google} onClick={() => void test()}>
          {testing ? <LoaderCircle size={14} className="spin" /> : <ExternalLink size={14} />} Tester avec le dernier mail reçu
        </button>
      </div>
      <Field
        label="Lien de recherche Superhuman (avancé)"
        hint="Laissez vide : Yateo Search ouvre Superhuman et copie la requête (/ puis Ctrl+V). Variables : {q} {email}"
      >
        <input value={st.superhumanSearchUrl} placeholder="(vide)" onChange={(e) => updateSettings({ superhumanSearchUrl: e.target.value })} />
      </Field>
    </div>
  );
}

function AiTab() {
  const st = useStore(settingsStore);
  useStore(indexVersion);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (kind: "chatgpt" | "claude") => {
    setBusy(kind);
    try {
      const n = await importHistory(kind);
      if (n !== null) toast(`${n.toLocaleString("fr-FR")} conversations importées`, "success");
    } catch (e) {
      toast(errorText(e), "error", 8000);
    } finally {
      setBusy(null);
    }
  };
  const info = (k: "chatgpt" | "claude") => {
    const idx = getIndex(k);
    return idx.items.length
      ? `${idx.items.length.toLocaleString("fr-FR")} conversations (import du ${fullDate(idx.meta.importedAt)})`
      : "Aucun historique importé";
  };
  return (
    <div className="tab">
      <h2>
        <SourceTile id="claude" size={22} /> ChatGPT & Claude
      </h2>
      <p className="lead small">
        « Demander à… » ouvre une nouvelle conversation pré-remplie (Claude s'ouvre dans l'app si elle est installée). Pour
        retrouver vos anciennes conversations, importez l'export officiel de vos données (aucune API ne permet de les lire
        en direct). Refaites l'import de temps en temps pour ajouter les nouvelles.
      </p>
      <h3>
        <SourceTile id="chatgpt" size={18} /> ChatGPT
      </h3>
      <ol className="steps">
        <li>
          ChatGPT → <b>Paramètres</b> → <b>Contrôles des données</b> → <b>Exporter les données</b>.
        </li>
        <li>Téléchargez le .zip reçu par e-mail, puis importez-le ici (inutile de le décompresser).</li>
      </ol>
      <div className="row-buttons">
        <button className="btn primary" disabled={!!busy} onClick={() => void run("chatgpt")}>
          {busy === "chatgpt" ? <LoaderCircle size={14} className="spin" /> : <Upload size={14} />} Importer l'export ChatGPT
        </button>
        <span className="muted small">{info("chatgpt")}</span>
      </div>
      <h3>
        <SourceTile id="claude" size={18} /> Claude
      </h3>
      <ol className="steps">
        <li>
          Claude → <b>Paramètres</b> → <b>Confidentialité</b> → <b>Exporter les données</b>.
        </li>
        <li>Téléchargez le .zip reçu par e-mail, puis importez-le ici.</li>
      </ol>
      <div className="row-buttons">
        <button className="btn primary" disabled={!!busy} onClick={() => void run("claude")}>
          {busy === "claude" ? <LoaderCircle size={14} className="spin" /> : <Upload size={14} />} Importer l'export Claude
        </button>
        <span className="muted small">{info("claude")}</span>
      </div>
      <Field label="Ouverture de Claude">
        <OpenModeSelect app="Claude" value={st.claudeOpen} onChange={(v) => updateSettings({ claudeOpen: v })} />
      </Field>
    </div>
  );
}

function IndexTab() {
  useStore(indexVersion);
  const s = useStore(ui);
  const rows: Array<[string, string]> = [
    ["notion", "Notion"],
    ["drive", "Google Drive"],
    ["pipedrive", "Pipedrive"],
    ["contacts", "Contacts (mails)"],
    ["chatgpt", "ChatGPT"],
    ["claude", "Claude"],
  ];
  return (
    <div className="tab">
      <h2>Index & données</h2>
      <p className="lead small">
        L'index contient uniquement des titres et des métadonnées, enregistrés sur ce PC. Il est mis à jour en arrière-plan
        (seulement les changements) et complété par une recherche en direct à chaque frappe.
      </p>
      <table className="stats">
        <thead>
          <tr>
            <th>Source</th>
            <th>Éléments</th>
            <th>Mise à jour</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, label]) => {
            const idx = getIndex(k);
            const n = k === "contacts" ? (idx.meta.list?.length ?? 0) : idx.items.length;
            const when = idx.meta.lastSync ?? idx.meta.importedAt;
            return (
              <tr key={k}>
                <td>{label}</td>
                <td>{n.toLocaleString("fr-FR")}</td>
                <td>{when ? relativeDate(when) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {s.sync.errors.length > 0 && (
        <div className="errors">
          {s.sync.errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}
      <div className="row-buttons">
        <button className="btn primary" disabled={s.sync.running} onClick={() => void syncAll(false)}>
          {s.sync.running ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Synchroniser maintenant
        </button>
        <button className="btn" disabled={s.sync.running} onClick={() => void syncAll(true)}>
          Tout reconstruire
        </button>
        <button
          className="btn"
          onClick={async () => {
            await clearAllIndexes();
            toast("Index vidé", "success");
          }}
        >
          <Trash2 size={14} /> Vider l'index
        </button>
      </div>
      {s.sync.running && <p className="muted small">{s.sync.label}</p>}
    </div>
  );
}

export function SettingsView() {
  const s = useStore(ui);
  const tab = s.settingsTab;
  return (
    <div className="view settings-view">
      <header className="top" data-tauri-drag-region>
        <button className="back" onClick={() => closeSettings()}>
          <ArrowLeft size={15} /> Retour <kbd>Échap</kbd>
        </button>
        <span className="top-title" data-tauri-drag-region>
          Paramètres
        </span>
      </header>
      <div className="settings-body">
        <nav className="settings-nav">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => ui.set({ settingsTab: t.id })}>
              {t.tile ? <SourceTile id={t.tile} size={16} /> : t.icon ? <t.icon size={16} /> : null}
              {t.label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === "welcome" && <Welcome />}
          {tab === "general" && <General />}
          {tab === "notion" && <NotionTab />}
          {tab === "pipedrive" && <PipedriveTab />}
          {tab === "google" && <GoogleTab />}
          {tab === "superhuman" && <SuperhumanTab />}
          {tab === "ai" && <AiTab />}
          {tab === "index" && <IndexTab />}
        </div>
      </div>
    </div>
  );
}
