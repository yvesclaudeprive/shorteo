//! Shorteo — partie native (Rust).
//!
//! Rôle : fenêtre flottante + raccourci global, icône dans la barre des tâches,
//! coffre-fort Windows pour les clés, requêtes HTTP (sans contraintes CORS),
//! détection des applications installées / ouvertes, ouverture des liens
//! (deeplinks), connexion Google (OAuth loopback) et import des historiques
//! ChatGPT / Claude.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;

const DEFAULT_SHORTCUT: &str = "Ctrl+Shift+Space";

/// Hôtes autorisés pour les requêtes HTTP (aucune autre destination possible).
const ALLOWED_HOST_SUFFIXES: &[&str] = &[".notion.com", ".pipedrive.com", ".googleapis.com"];

/** Outils MCP Notion autorisés : uniquement de la lecture. */
const NOTION_MCP_READ_TOOLS: &[&str] = &["notion-search", "notion-fetch", "notion-list-favorite-pages"];

/// Schémas autorisés à l'ouverture (sites web + applications).
const ALLOWED_SCHEMES: &[&str] = &[
    "https://",
    "http://",
    "notion://",
    "superhuman://",
    "claude://",
    "chatgpt://",
    "mailto:",
    "tel:",
];

struct AppState {
    shortcut: Mutex<Option<Shortcut>>,
    shortcut_error: Mutex<Option<String>>,
    hide_on_blur: Mutex<bool>,
    blur_suspended: Mutex<bool>,
    oauth: Mutex<Option<TcpListener>>,
    sys: Mutex<sysinfo::System>,
    http: reqwest::Client,
    native_log: Mutex<std::collections::VecDeque<LogLine>>,
}

// ---------------------------------------------------------------------------
// Fenêtre
// ---------------------------------------------------------------------------

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

/// Centre la fenêtre (un peu au-dessus du milieu) sur l'écran où se trouve la souris.
fn place_on_active_monitor(app: &AppHandle, w: &WebviewWindow) {
    let size = match w.outer_size() {
        Ok(s) => s,
        Err(_) => return,
    };
    if let (Ok(cursor), Ok(monitors)) = (app.cursor_position(), w.available_monitors()) {
        for m in monitors {
            let p = m.position();
            let s = m.size();
            let (x0, y0) = (p.x as f64, p.y as f64);
            let (x1, y1) = (x0 + s.width as f64, y0 + s.height as f64);
            if cursor.x >= x0 && cursor.x < x1 && cursor.y >= y0 && cursor.y < y1 {
                let x = p.x + (s.width as i32 - size.width as i32) / 2;
                let y = p.y + ((s.height as i32 - size.height as i32) / 3).max(0);
                let _ = w.set_position(PhysicalPosition::new(x, y));
                return;
            }
        }
    }
    let _ = w.center();
}

fn show_window(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        if !w.is_visible().unwrap_or(false) {
            place_on_active_monitor(app, &w);
        }
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        let _ = w.emit("window-shown", ());
    }
}

fn hide_window_inner(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        let _ = w.hide();
        let _ = w.emit("window-hidden", ());
    }
}

fn toggle_window(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        let visible = w.is_visible().unwrap_or(false);
        let focused = w.is_focused().unwrap_or(false);
        if visible && focused {
            hide_window_inner(app);
        } else {
            show_window(app);
        }
    }
}

/// La fenêtre est-elle toujours l'application au premier plan ?
/// (Sous Windows, la zone d'affichage perd brièvement le focus pendant un déplacement :
/// on ne masque la fenêtre que si une AUTRE application est vraiment passée devant.)
#[cfg(windows)]
fn is_foreground(w: &WebviewWindow) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    match w.hwnd() {
        Ok(h) => unsafe { GetForegroundWindow() as usize == h.0 as usize },
        Err(_) => false,
    }
}

#[cfg(not(windows))]
fn is_foreground(w: &WebviewWindow) -> bool {
    w.is_focused().unwrap_or(false)
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    hide_window_inner(&app);
}

#[tauri::command]
fn show_main_window(app: AppHandle) {
    show_window(&app);
}

/// Empêche temporairement la fenêtre de se masquer quand elle perd le focus
/// (sélecteur de fichier, connexion Google…).
#[tauri::command]
fn suspend_blur(state: State<AppState>, suspended: bool) {
    *state.blur_suspended.lock().unwrap() = suspended;
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

// ---------------------------------------------------------------------------
// Fichiers locaux (paramètres + index)
// ---------------------------------------------------------------------------

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn safe_name(name: &str) -> Result<&str, String> {
    let ok = !name.is_empty()
        && name.len() < 64
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(name)
    } else {
        Err("Nom de fichier invalide".into())
    }
}

#[tauri::command]
fn settings_load(app: AppHandle) -> Result<Option<String>, String> {
    let p = data_dir(&app)?.join("settings.json");
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(p).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
fn settings_save(app: AppHandle, state: State<AppState>, data: String) -> Result<(), String> {
    let v: serde_json::Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    if let Some(b) = v.get("hideOnBlur").and_then(|x| x.as_bool()) {
        *state.hide_on_blur.lock().unwrap() = b;
    }
    write_atomic(&data_dir(&app)?.join("settings.json"), data.as_bytes())
}

#[tauri::command]
fn index_load(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let p = data_dir(&app)?.join("index").join(format!("{}.json", safe_name(&name)?));
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(p).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
fn index_save(app: AppHandle, name: String, data: String) -> Result<(), String> {
    let dir = data_dir(&app)?.join("index");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(format!("{}.json", safe_name(&name)?)), data.as_bytes())
}

#[tauri::command]
fn index_clear(app: AppHandle) -> Result<(), String> {
    let dir = data_dir(&app)?.join("index");
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Coffre-fort des clés (Gestionnaire d'identification Windows)
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod secrets {
    use std::path::Path;
    const SERVICE: &str = "yateo-search"; // identifiant interne conservé (clés existantes)

    fn entry(key: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())
    }

    pub fn get(_dir: &Path, key: &str) -> Result<Option<String>, String> {
        match entry(key)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn set(_dir: &Path, key: &str, value: &str) -> Result<(), String> {
        entry(key)?.set_password(value).map_err(|e| e.to_string())
    }

    pub fn delete(_dir: &Path, key: &str) -> Result<(), String> {
        match entry(key)?.delete_credential() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

/// Hors Windows (développement uniquement) : simple fichier local.
#[cfg(not(windows))]
mod secrets {
    use std::collections::HashMap;
    use std::fs;
    use std::path::Path;

    fn load(dir: &Path) -> HashMap<String, String> {
        fs::read_to_string(dir.join("secrets.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save(dir: &Path, map: &HashMap<String, String>) -> Result<(), String> {
        let data = serde_json::to_string(map).map_err(|e| e.to_string())?;
        fs::write(dir.join("secrets.json"), data).map_err(|e| e.to_string())
    }

    pub fn get(dir: &Path, key: &str) -> Result<Option<String>, String> {
        Ok(load(dir).get(key).cloned())
    }

    pub fn set(dir: &Path, key: &str, value: &str) -> Result<(), String> {
        let mut m = load(dir);
        m.insert(key.to_string(), value.to_string());
        save(dir, &m)
    }

    pub fn delete(dir: &Path, key: &str) -> Result<(), String> {
        let mut m = load(dir);
        m.remove(key);
        save(dir, &m)
    }
}

#[tauri::command]
fn secret_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    secrets::get(&data_dir(&app)?, safe_name(&key)?)
}

#[tauri::command]
fn secret_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    secrets::set(&data_dir(&app)?, safe_name(&key)?, &value)
}

#[tauri::command]
fn secret_delete(app: AppHandle, key: String) -> Result<(), String> {
    secrets::delete(&data_dir(&app)?, safe_name(&key)?)
}

// ---------------------------------------------------------------------------
// Applications : installées (protocole enregistré) / ouvertes (processus)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct AppsStatus {
    running: HashMap<String, bool>,
    installed: HashMap<String, bool>,
}

#[cfg(windows)]
fn protocol_registered(scheme: &str) -> bool {
    use winreg::enums::HKEY_CLASSES_ROOT;
    use winreg::RegKey;
    RegKey::predef(HKEY_CLASSES_ROOT)
        .open_subkey(scheme)
        .map(|k| k.get_value::<String, _>("URL Protocol").is_ok())
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn protocol_registered(_scheme: &str) -> bool {
    false
}

#[tauri::command]
fn apps_status(state: State<AppState>, processes: Vec<String>, schemes: Vec<String>) -> AppsStatus {
    let mut running = HashMap::new();
    if !processes.is_empty() {
        let mut sys = state.sys.lock().unwrap();
        sys.refresh_processes_specifics(
            sysinfo::ProcessesToUpdate::All,
            true,
            sysinfo::ProcessRefreshKind::nothing(),
        );
        let names: HashSet<String> = sys
            .processes()
            .values()
            .map(|p| p.name().to_string_lossy().to_lowercase())
            .collect();
        for p in processes {
            let key = p.to_lowercase();
            running.insert(p, names.contains(&key));
        }
    }
    let installed = schemes
        .into_iter()
        .map(|s| {
            let r = protocol_registered(&s);
            (s, r)
        })
        .collect();
    AppsStatus { running, installed }
}

#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    let lower = url.to_lowercase();
    if !ALLOWED_SCHEMES.iter().any(|p| lower.starts_with(p)) {
        return Err(format!("Lien non autorisé : {url}"));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Recherche native : Notion, Superhuman, Pipedrive, Claude et ChatGPT n'acceptent pas
// de recherche par lien. Shorteo met l'application au premier plan (ou la lance), puis
// tape son raccourci de recherche et colle la requête (déjà copiée), UNIQUEMENT si
// l'application visée est au premier plan. Les séquences sont fixées ici.
// ---------------------------------------------------------------------------

#[cfg(windows)]
pub mod keys {
    use std::mem::size_of;
    use std::time::{Duration, Instant};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, MapVirtualKeyW, SendInput, VkKeyScanW, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
        KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, MAPVK_VK_TO_VSC, VK_CONTROL, VK_DELETE, VK_DIVIDE, VK_DOWN, VK_END,
        VK_ESCAPE, VK_HOME, VK_INSERT, VK_LEFT, VK_LWIN, VK_MENU, VK_NEXT, VK_PRIOR, VK_RCONTROL, VK_RETURN, VK_RIGHT,
        VK_OEM_2, VK_RMENU, VK_RWIN, VK_SHIFT, VK_UP,
    };

    fn extended(vk: u16) -> bool {
        [VK_DIVIDE, VK_RCONTROL, VK_RMENU, VK_INSERT, VK_DELETE, VK_HOME, VK_END, VK_PRIOR, VK_NEXT, VK_LEFT, VK_UP, VK_RIGHT, VK_DOWN]
            .contains(&vk)
    }

    /// Touche avec son code de balayage (comme un vrai clavier : les navigateurs et
    /// applications Electron lisent aussi ce code).
    fn key(vk: u16, up: bool) -> INPUT {
        let scan = unsafe { MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC) } as u16;
        let mut flags = if up { KEYEVENTF_KEYUP } else { 0 };
        if extended(vk) {
            flags |= KEYEVENTF_EXTENDEDKEY;
        }
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT { wVk: vk, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 },
            },
        }
    }

    fn send(inputs: &[INPUT]) -> u32 {
        unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), size_of::<INPUT>() as i32) }
    }

    pub fn ctrl(letter: u16) -> u32 {
        send(&[key(VK_CONTROL, false), key(letter, false), key(letter, true), key(VK_CONTROL, true)])
    }

    pub fn tap(vk: u16) -> u32 {
        send(&[key(vk, false), key(vk, true)])
    }

    /// Tape un caractère avec la vraie touche du clavier actuel (AZERTY, QWERTY…).
    pub fn type_char(c: char) -> u32 {
        let r = unsafe { VkKeyScanW(c as u16) };
        if r == -1 {
            return if c == '/' { tap(VK_DIVIDE) } else { 0 };
        }
        let vk = (r as u16) & 0xff;
        let mods = ((r as u16) >> 8) & 0xff;
        let mut down = Vec::new();
        if mods & 1 != 0 {
            down.push(VK_SHIFT);
        }
        if mods & 2 != 0 {
            down.push(VK_CONTROL);
        }
        if mods & 4 != 0 {
            down.push(VK_MENU);
        }
        let mut seq: Vec<INPUT> = down.iter().map(|m| key(*m, false)).collect();
        seq.push(key(vk, false));
        seq.push(key(vk, true));
        seq.extend(down.iter().rev().map(|m| key(*m, true)));
        send(&seq)
    }

    /// Tape un mot lettre par lettre.
    pub fn type_text(s: &str) -> u32 {
        s.chars()
            .map(|c| {
                let n = type_char(c);
                std::thread::sleep(Duration::from_millis(35));
                n
            })
            .sum()
    }

    /// Une touche Ctrl, Maj, Alt ou Windows est-elle physiquement enfoncée ?
    pub fn modifiers_down() -> bool {
        [VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN]
            .iter()
            .any(|vk| unsafe { GetAsyncKeyState(*vk as i32) } as u16 & 0x8000 != 0)
    }

    /// Attend que l'utilisateur ait relâché Ctrl / Maj / Alt / Windows (sinon
    /// Ctrl+P deviendrait Ctrl+Maj+P, etc.).
    pub fn wait_modifiers_released(max: Duration) -> bool {
        let deadline = Instant::now() + max;
        while modifiers_down() {
            if Instant::now() > deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(40));
        }
        true
    }

    pub const K_A: u16 = 0x41;
    pub const K_C: u16 = 0x43;
    pub const K_K: u16 = 0x4B;
    pub const K_P: u16 = 0x50;
    pub const K_V: u16 = 0x56;
    pub const ENTER: u16 = VK_RETURN;
    pub const ESCAPE: u16 = VK_ESCAPE;
    /// Touche « / » d'un clavier américain = touche « : » d'un clavier AZERTY (code 191).
    pub const SEARCH_KEY: u16 = VK_OEM_2;
}

/// Caractéristiques d'une fenêtre candidate (dans l'ordre d'empilement, la plus haute d'abord).
#[derive(Clone, Debug, Default)]
pub struct WinCand {
    pub w: i32,
    pub h: i32,
    pub iconic: bool,
    pub tool: bool,
    pub owned: bool,
    pub topmost: bool,
}

/// Choix de la fenêtre principale d'une application parmi ses fenêtres visibles :
/// on écarte les petites fenêtres, les palettes, les fenêtres « toujours au-dessus »
/// (mini-recherche, notifications…) et celles qui appartiennent à une autre fenêtre.
pub fn pick_window(c: &[WinCand]) -> Option<usize> {
    let main = |x: &WinCand| !x.tool && !x.owned && (x.iconic || (x.w >= 400 && x.h >= 300));
    c.iter()
        .position(|x| main(x) && !x.topmost)
        .or_else(|| c.iter().position(main))
        .or_else(|| c.iter().position(|x| !x.tool && !x.owned))
}

/// Fenêtres : premier plan, recherche de la fenêtre d'un processus, lancement.
#[cfg(windows)]
pub mod winapp {
    use super::WinCand;
    use std::collections::HashSet;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetForegroundWindow, GetWindow, GetWindowLongW, GetWindowRect, GetWindowTextLengthW,
        GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow,
        GWL_EXSTYLE, GW_OWNER, SW_RESTORE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
    };

    pub fn pid_of(hwnd: HWND) -> u32 {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        pid
    }

    /// Identifiants des processus portant ce nom (ex. « notion.exe »).
    pub fn pids(sys: &mut sysinfo::System, name: &str) -> HashSet<u32> {
        sys.refresh_processes_specifics(sysinfo::ProcessesToUpdate::All, true, sysinfo::ProcessRefreshKind::nothing());
        sys.processes()
            .iter()
            .filter(|(_, p)| p.name().to_string_lossy().eq_ignore_ascii_case(name))
            .map(|(pid, _)| pid.as_u32())
            .collect()
    }

    /// Nom du programme d'un processus (pour le journal).
    pub fn process_name(sys: &mut sysinfo::System, pid: u32) -> String {
        let p = sysinfo::Pid::from_u32(pid);
        sys.refresh_processes_specifics(sysinfo::ProcessesToUpdate::Some(&[p]), true, sysinfo::ProcessRefreshKind::nothing());
        sys.process(p).map(|x| x.name().to_string_lossy().to_string()).unwrap_or_else(|| "?".into())
    }

    pub fn foreground_pid() -> u32 {
        let h = unsafe { GetForegroundWindow() };
        if h.is_null() {
            0
        } else {
            pid_of(h)
        }
    }

    /// Titre de la fenêtre au premier plan (pour un navigateur : le titre de l'onglet).
    pub fn foreground_title() -> String {
        let h = unsafe { GetForegroundWindow() };
        if h.is_null() {
            return String::new();
        }
        let mut buf = [0u16; 512];
        let n = unsafe { GetWindowTextW(h, buf.as_mut_ptr(), buf.len() as i32) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }

    pub struct Win {
        pub hwnd: HWND,
        pub class: String,
        pub cand: WinCand,
    }

    struct Search {
        pids: HashSet<u32>,
        found: Vec<Win>,
    }

    unsafe extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> i32 {
        let s = &mut *(lparam as *mut Search);
        if IsWindowVisible(hwnd) != 0 && GetWindowTextLengthW(hwnd) > 0 && s.pids.contains(&pid_of(hwnd)) {
            let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
            let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            GetWindowRect(hwnd, &mut r);
            let mut cls = [0u16; 128];
            let n = GetClassNameW(hwnd, cls.as_mut_ptr(), cls.len() as i32);
            s.found.push(Win {
                hwnd,
                class: String::from_utf16_lossy(&cls[..n.max(0) as usize]),
                cand: WinCand {
                    w: r.right - r.left,
                    h: r.bottom - r.top,
                    iconic: IsIconic(hwnd) != 0,
                    tool: ex & WS_EX_TOOLWINDOW != 0,
                    owned: !GetWindow(hwnd, GW_OWNER).is_null(),
                    topmost: ex & WS_EX_TOPMOST != 0,
                },
            });
        }
        1
    }

    /// Fenêtres visibles (avec un titre) des processus, de la plus haute à la plus basse.
    pub fn windows_of(pids: &HashSet<u32>) -> Vec<Win> {
        if pids.is_empty() {
            return Vec::new();
        }
        let mut s = Search { pids: pids.clone(), found: Vec::new() };
        unsafe { EnumWindows(Some(enum_cb), &mut s as *mut Search as LPARAM) };
        s.found
    }

    /// Fenêtre principale d'un des processus.
    pub fn find_window(pids: &HashSet<u32>) -> Option<HWND> {
        let wins = windows_of(pids);
        let cands: Vec<WinCand> = wins.iter().map(|w| w.cand.clone()).collect();
        super::pick_window(&cands).map(|i| wins[i].hwnd)
    }

    /// Met la fenêtre au premier plan (restaurée si réduite).
    pub fn focus(hwnd: HWND) -> bool {
        unsafe {
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            }
            SetForegroundWindow(hwnd) != 0
        }
    }

    /// Programme associé à un protocole (ex. « notion » → …\Notion.exe).
    pub fn exe_for_scheme(scheme: &str) -> Option<String> {
        use winreg::enums::HKEY_CLASSES_ROOT;
        use winreg::RegKey;
        let cmd: String = RegKey::predef(HKEY_CLASSES_ROOT)
            .open_subkey(format!("{scheme}\\shell\\open\\command"))
            .ok()?
            .get_value("")
            .ok()?;
        let cmd = cmd.trim();
        let exe = if let Some(rest) = cmd.strip_prefix('"') {
            rest.split('"').next()?.to_string()
        } else {
            cmd.split_whitespace().next()?.to_string()
        };
        std::path::Path::new(&exe).exists().then_some(exe)
    }
}

/// Cible d'une recette : application (processus + protocole pour la lancer) ou
/// onglet de navigateur (mot attendu dans le titre de l'onglet une fois chargé).
#[cfg(windows)]
struct Target {
    process: &'static str,
    scheme: Option<&'static str>,
    browser_title: Option<&'static str>,
}

#[cfg(windows)]
fn recipe_target(recipe: &str) -> Option<Target> {
    let app = |process, scheme| Some(Target { process, scheme, browser_title: None });
    let web = |title| Some(Target { process: "", scheme: None, browser_title: Some(title) });
    match recipe {
        "notion" => app("notion.exe", Some("notion")),
        "superhuman" | "superhuman_palette" => app("superhuman.exe", Some("superhuman")),
        "claude" => app("claude.exe", Some("claude")),
        "chatgpt" => app("chatgpt.exe", None),
        "pipedrive" => web("pipedrive"),
        "superhuman_web" => web("superhuman"),
        "claude_web" => web("claude"),
        "chatgpt_web" => web("chatgpt"),
        _ => None,
    }
}

#[cfg(windows)]
const BROWSERS: &[&str] = &[
    "chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "vivaldi.exe", "arc.exe",
];

/// Séquence de touches de chaque recette. Renvoie le nombre de touches acceptées par Windows.
/// Superhuman : la touche de la recherche est celle du « / » d'un clavier américain, soit
/// la touche « : » d'un clavier AZERTY, SANS Maj (avec Maj, Superhuman ouvre Ask AI).
/// Entrée n'est envoyée que dans la recherche de Superhuman (elle lance la recherche).
#[cfg(windows)]
fn type_recipe(recipe: &str) -> u32 {
    let ms = |n: u64| std::thread::sleep(Duration::from_millis(n));
    let mut n = 0;
    match recipe {
        "notion" => {
            // Échap : sort du bloc en cours d'édition / ferme un menu, puis Ctrl+P = recherche
            n += keys::tap(keys::ESCAPE);
            ms(250);
            n += keys::ctrl(keys::K_P);
            ms(900);
            n += keys::ctrl(keys::K_V);
        }
        "superhuman" | "superhuman_web" => {
            // Échap : ferme un brouillon ouvert (gardé en brouillon) pour ne rien y taper
            n += keys::tap(keys::ESCAPE);
            ms(250);
            n += keys::tap(keys::SEARCH_KEY);
            ms(700);
            n += keys::ctrl(keys::K_V);
            ms(400);
            n += keys::tap(keys::ENTER);
        }
        "superhuman_palette" => {
            // variante : palette de commandes (Ctrl+K) → commande « Search »
            n += keys::tap(keys::ESCAPE);
            ms(250);
            n += keys::ctrl(keys::K_K);
            ms(700);
            n += keys::type_text("search");
            ms(600);
            n += keys::tap(keys::ENTER);
            ms(800);
            n += keys::ctrl(keys::K_V);
            ms(400);
            n += keys::tap(keys::ENTER);
        }
        "pipedrive" => {
            n += keys::type_char('/');
            ms(800);
            n += keys::ctrl(keys::K_V);
        }
        "claude" | "chatgpt" | "claude_web" | "chatgpt_web" => {
            // Ctrl+K : recherche dans les conversations ; la requête est saisie, sans Entrée
            n += keys::ctrl(keys::K_K);
            ms(800);
            n += keys::ctrl(keys::K_V);
        }
        _ => {}
    }
    n
}

/// Résultat : « typed » (recherche saisie), « not_installed » (application absente :
/// l'appelant ouvre le site web), « not_foreground » (rien n'a été tapé).
/// Chaque étape est notée dans le journal (Réglages › Général › Diagnostic).
#[tauri::command]
async fn native_search(app: AppHandle, recipe: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        let Target { process, scheme, browser_title } = recipe_target(&recipe).ok_or("Recette inconnue")?;
        let browser = browser_title.is_some();
        let res = tauri::async_runtime::spawn_blocking(move || -> String {
            let state = app.state::<AppState>();
            let t0 = Instant::now();
            let log = |m: String| nlog(&app, format!("{recipe} · {} ms · {m}", t0.elapsed().as_millis()));
            log("début".into());
            let mut cold = false;
            if !browser {
                let pids = winapp::pids(&mut state.sys.lock().unwrap(), process);
                let wins = winapp::windows_of(&pids);
                log(format!("{} processus {process}, {} fenêtre(s) visible(s)", pids.len(), wins.len()));
                let cands: Vec<WinCand> = wins.iter().map(|w| w.cand.clone()).collect();
                match pick_window(&cands) {
                    Some(i) => {
                        let w = &wins[i];
                        let ok = winapp::focus(w.hwnd);
                        log(format!(
                            "fenêtre {} {}×{}{}{} → premier plan {}",
                            w.class,
                            w.cand.w,
                            w.cand.h,
                            if w.cand.iconic { ", réduite" } else { "" },
                            if w.cand.topmost { ", toujours au-dessus" } else { "" },
                            if ok { "accepté" } else { "refusé" }
                        ));
                    }
                    None => match scheme.and_then(winapp::exe_for_scheme) {
                        Some(exe) => {
                            if let Err(e) = std::process::Command::new(&exe).spawn() {
                                log(format!("lancement impossible : {e}"));
                                return "not_installed".into();
                            }
                            log("application lancée (elle n'était pas ouverte)".into());
                            cold = true;
                        }
                        None => {
                            log("application non installée → site web".into());
                            return "not_installed".into();
                        }
                    },
                }
            }
            hide_window_inner(&app);
            // attendre que l'application (ou le navigateur) soit au premier plan
            let is_target = || {
                let fg = winapp::foreground_pid();
                if fg == 0 {
                    return false;
                }
                let mut sys = state.sys.lock().unwrap();
                if browser {
                    BROWSERS.iter().any(|b| winapp::pids(&mut sys, b).contains(&fg))
                } else {
                    winapp::pids(&mut sys, process).contains(&fg)
                }
            };
            let fg_name = || winapp::process_name(&mut state.sys.lock().unwrap(), winapp::foreground_pid());
            let deadline = Instant::now() + Duration::from_secs(if cold { 15 } else { 8 });
            while !is_target() {
                if Instant::now() > deadline {
                    log(format!("pas au premier plan (premier plan : {}) → rien n'est tapé", fg_name()));
                    return "not_foreground".into();
                }
                std::thread::sleep(Duration::from_millis(150));
            }
            log(format!("au premier plan ({})", fg_name()));
            if let Some(word) = browser_title {
                // attendre que l'onglet soit chargé (son titre contient le nom du site),
                // puis que l'application web démarre
                let deadline = Instant::now() + Duration::from_secs(15);
                loop {
                    if winapp::foreground_title().to_lowercase().contains(word) {
                        log(format!("onglet « {word} » chargé"));
                        break;
                    }
                    if Instant::now() > deadline {
                        log(format!("titre « {word} » jamais vu : essai quand même"));
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
                // chatgpt.com met plus de temps à démarrer : sinon Ctrl+K va à la barre d'adresse
                std::thread::sleep(Duration::from_millis(if recipe == "chatgpt_web" { 4500 } else { 2500 }));
            } else {
                std::thread::sleep(Duration::from_millis(if cold { 5000 } else { 800 }));
            }
            if !is_target() {
                log(format!("n'est plus au premier plan (premier plan : {}) → rien n'est tapé", fg_name()));
                return "not_foreground".into();
            }
            if !keys::wait_modifiers_released(Duration::from_secs(3)) {
                log("Ctrl / Maj / Alt toujours enfoncée → rien n'est tapé".into());
                return "not_foreground".into();
            }
            let n = type_recipe(&recipe);
            log(format!("séquence tapée ({n} touches acceptées par Windows)"));
            "typed".into()
        })
        .await
        .map_err(|e| e.to_string())?;
        Ok(res)
    }
    #[cfg(not(windows))]
    {
        nlog(&app, format!("{recipe} · disponible uniquement sous Windows"));
        Ok("not_installed".into())
    }
}

#[derive(Serialize, Clone)]
struct LogLine {
    t: u64,
    msg: String,
}

/// Journal de diagnostic (en mémoire, 300 lignes) : étapes de la recherche native.
fn nlog(app: &AppHandle, msg: String) {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let state = app.state::<AppState>();
    let mut l = state.native_log.lock().unwrap();
    l.push_back(LogLine { t, msg });
    while l.len() > 300 {
        l.pop_front();
    }
}

#[tauri::command]
fn native_log(state: State<AppState>) -> Vec<LogLine> {
    state.native_log.lock().unwrap().iter().cloned().collect()
}

#[tauri::command]
fn native_log_clear(state: State<AppState>) {
    state.native_log.lock().unwrap().clear();
}

// ---------------------------------------------------------------------------
// Raccourci global
// ---------------------------------------------------------------------------

fn register_shortcut(app: &AppHandle, s: &str) -> Result<Shortcut, String> {
    let sc: Shortcut = s
        .parse()
        .map_err(|e| format!("Raccourci invalide « {s} » : {e}"))?;
    app.global_shortcut()
        .register(sc)
        .map_err(|e| format!("Raccourci « {s} » indisponible (déjà utilisé par une autre application ?) : {e}"))?;
    Ok(sc)
}

#[tauri::command]
fn set_shortcut(app: AppHandle, state: State<AppState>, shortcut: String) -> Result<(), String> {
    let mut current = state.shortcut.lock().unwrap();
    let previous = current.take();
    if let Some(old) = previous {
        let _ = app.global_shortcut().unregister(old);
    }
    match register_shortcut(&app, &shortcut) {
        Ok(sc) => {
            *current = Some(sc);
            *state.shortcut_error.lock().unwrap() = None;
            Ok(())
        }
        Err(e) => {
            if let Some(old) = previous {
                if app.global_shortcut().register(old).is_ok() {
                    *current = Some(old);
                }
            }
            Err(e)
        }
    }
}

#[derive(Serialize)]
struct ShortcutStatus {
    error: Option<String>,
}

#[tauri::command]
fn shortcut_status(state: State<AppState>) -> ShortcutStatus {
    ShortcutStatus {
        error: state.shortcut_error.lock().unwrap().clone(),
    }
}

// ---------------------------------------------------------------------------
// HTTP (les appels API passent par ici : pas de CORS, hôtes limités)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct HttpReq {
    method: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
struct HttpRes {
    status: u16,
    body: String,
    retry_after: Option<String>,
    headers: HashMap<String, String>,
}

fn host_allowed(url: &str) -> bool {
    match reqwest::Url::parse(url) {
        Ok(u) if u.scheme() == "https" => {
            let host = u.host_str().unwrap_or("").to_lowercase();
            ALLOWED_HOST_SUFFIXES
                .iter()
                .any(|s| host == s.trim_start_matches('.') || (s.starts_with('.') && host.ends_with(s)))
        }
        _ => false,
    }
}

/// Lecture seule garantie : seules les requêtes GET sont permises, plus quelques POST
/// qui ne modifient rien : la recherche Notion (API), la connexion (jetons, enregistrement
/// du client OAuth) et, pour Notion MCP, uniquement les messages de session et les outils
/// de lecture (recherche, consultation). Toute autre écriture est refusée ici, quel que
/// soit le jeton utilisé (y compris un jeton Pipedrive ayant des droits d'écriture).
fn method_allowed(method: &reqwest::Method, url: &str, body: Option<&str>) -> bool {
    if method == reqwest::Method::GET {
        return true;
    }
    if method != reqwest::Method::POST {
        return false;
    }
    let u = match reqwest::Url::parse(url) {
        Ok(u) => u,
        Err(_) => return false,
    };
    let host = u.host_str().unwrap_or("").to_lowercase();
    let path = u.path().trim_end_matches('/');
    if host == "oauth2.googleapis.com" {
        return path == "/token";
    }
    if host.ends_with(".notion.com") {
        if path.ends_with("/token") || path.ends_with("/register") {
            return true;
        }
        if host == "api.notion.com" && path == "/v1/search" {
            return true;
        }
        if path == "/mcp" {
            return mcp_body_is_read_only(body.unwrap_or(""));
        }
    }
    false
}

fn mcp_body_is_read_only(body: &str) -> bool {
    let v: serde_json::Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let msgs: Vec<&serde_json::Value> = match &v {
        serde_json::Value::Array(a) => a.iter().collect(),
        other => vec![other],
    };
    !msgs.is_empty()
        && msgs.iter().all(|m| match m.get("method").and_then(|x| x.as_str()) {
            Some("initialize") | Some("notifications/initialized") | Some("tools/list") | Some("ping") => true,
            Some("tools/call") => m
                .get("params")
                .and_then(|p| p.get("name"))
                .and_then(|n| n.as_str())
                .map(|n| NOTION_MCP_READ_TOOLS.contains(&n))
                .unwrap_or(false),
            _ => false,
        })
}

#[tauri::command]
async fn http_request(state: State<'_, AppState>, req: HttpReq) -> Result<HttpRes, String> {
    if !host_allowed(&req.url) {
        return Err(format!("Destination non autorisée : {}", req.url));
    }
    let method = reqwest::Method::from_bytes(req.method.to_uppercase().as_bytes())
        .map_err(|e| e.to_string())?;
    if !method_allowed(&method, &req.url, req.body.as_deref()) {
        return Err("Action refusée : Shorteo fonctionne en lecture seule".into());
    }
    let mut rb = state
        .http
        .request(method, &req.url)
        .timeout(Duration::from_millis(req.timeout_ms.unwrap_or(20_000)));
    if let Some(headers) = req.headers {
        for (k, v) in headers {
            rb = rb.header(k, v);
        }
    }
    if let Some(b) = req.body {
        rb = rb.body(b);
    }
    let res = rb.send().await.map_err(|e| format!("Erreur réseau : {e}"))?;
    let status = res.status().as_u16();
    let retry_after = res
        .headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let mut headers = HashMap::new();
    for name in ["mcp-session-id", "content-type", "www-authenticate"] {
        if let Some(v) = res.headers().get(name).and_then(|v| v.to_str().ok()) {
            headers.insert(name.to_string(), v.to_string());
        }
    }
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok(HttpRes {
        status,
        body,
        retry_after,
        headers,
    })
}

// ---------------------------------------------------------------------------
// Connexion Google : redirection vers 127.0.0.1 (flux « loopback » OAuth)
// ---------------------------------------------------------------------------

#[tauri::command]
fn oauth_prepare(state: State<AppState>) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    *state.oauth.lock().unwrap() = Some(listener);
    Ok(port)
}

fn oauth_page(ok: bool) -> String {
    let (title, text) = if ok {
        ("Connexion réussie", "Shorteo est connecté à Google. Vous pouvez fermer cet onglet.")
    } else {
        ("Connexion annulée", "La connexion à Google n'a pas abouti. Vous pouvez fermer cet onglet et réessayer.")
    };
    format!(
        "<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\"><title>{title}</title>\
         <style>body{{font-family:'Segoe UI',system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#0f0f14;color:#f4f4f6}}\
         .c{{text-align:center;padding:40px;border-radius:16px;background:#1a1a22;border:1px solid #2a2a35}}\
         h1{{font-size:20px;margin:0 0 8px}}p{{color:#a1a1aa;margin:0}}</style></head>\
         <body><div class=\"c\"><h1>{title}</h1><p>{text}</p></div></body></html>"
    )
}

fn wait_for_redirect(listener: TcpListener) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let mut buf = [0u8; 8192];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = request
                    .lines()
                    .next()
                    .and_then(|l| l.split_whitespace().nth(1))
                    .unwrap_or("")
                    .to_string();
                if path.contains("code=") || path.contains("error=") {
                    let body = oauth_page(path.contains("code="));
                    let _ = write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = stream.flush();
                    return Ok(path);
                }
                let _ = write!(stream, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() > deadline {
                    return Err("Délai dépassé : connexion Google annulée".into());
                }
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

#[tauri::command]
async fn oauth_wait(app: AppHandle) -> Result<String, String> {
    let listener = {
        let state = app.state::<AppState>();
        let mut guard = state.oauth.lock().unwrap();
        guard.take()
    }
    .ok_or_else(|| "Aucune connexion en attente".to_string())?;
    let result = tauri::async_runtime::spawn_blocking(move || wait_for_redirect(listener))
        .await
        .map_err(|e| e.to_string())?;
    show_window(&app);
    result
}

// ---------------------------------------------------------------------------
// Import des historiques ChatGPT / Claude (export officiel .zip ou .json)
// ---------------------------------------------------------------------------

const HISTORY_TEXT_LIMIT: usize = 4000;

#[derive(Serialize)]
struct Conversation {
    id: String,
    title: String,
    updated_ms: Option<f64>,
    updated_iso: Option<String>,
    text: String,
}

#[derive(Deserialize)]
struct GptConv {
    id: Option<String>,
    conversation_id: Option<String>,
    title: Option<String>,
    update_time: Option<serde_json::Value>,
    create_time: Option<serde_json::Value>,
    mapping: Option<HashMap<String, GptNode>>,
}

#[derive(Deserialize)]
struct GptNode {
    message: Option<GptMsg>,
}

#[derive(Deserialize)]
struct GptMsg {
    author: Option<GptAuthor>,
    content: Option<GptContent>,
    create_time: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct GptAuthor {
    role: Option<String>,
}

#[derive(Deserialize)]
struct GptContent {
    parts: Option<Vec<serde_json::Value>>,
}

#[derive(Deserialize)]
struct ClaudeConv {
    uuid: Option<String>,
    name: Option<String>,
    updated_at: Option<String>,
    created_at: Option<String>,
    chat_messages: Option<Vec<ClaudeMsg>>,
}

#[derive(Deserialize)]
struct ClaudeMsg {
    sender: Option<String>,
    text: Option<String>,
}

fn as_f64(v: &Option<serde_json::Value>) -> Option<f64> {
    match v {
        Some(serde_json::Value::Number(n)) => n.as_f64(),
        Some(serde_json::Value::String(s)) => s.parse().ok(),
        _ => None,
    }
}

fn push_limited(out: &mut String, s: &str) {
    if out.len() >= HISTORY_TEXT_LIMIT {
        return;
    }
    if !out.is_empty() {
        out.push_str(" · ");
    }
    let remaining = HISTORY_TEXT_LIMIT.saturating_sub(out.len());
    if s.len() <= remaining {
        out.push_str(s);
    } else {
        let mut end = remaining;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        out.push_str(&s[..end]);
    }
}

fn read_conversation_files(path: &str) -> Result<Vec<Vec<u8>>, String> {
    if path.to_lowercase().ends_with(".zip") {
        let file = fs::File::open(path).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
            let name = entry.name().to_lowercase();
            let base = name.rsplit('/').next().unwrap_or(&name).to_string();
            if base.starts_with("conversations") && base.ends_with(".json") {
                let mut buf = Vec::with_capacity(entry.size() as usize);
                entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
                out.push(buf);
            }
        }
        if out.is_empty() {
            return Err("Aucun fichier conversations.json trouvé dans l'archive".into());
        }
        Ok(out)
    } else {
        Ok(vec![fs::read(path).map_err(|e| e.to_string())?])
    }
}

fn import_history_blocking(path: &str, kind: &str) -> Result<Vec<Conversation>, String> {
    let files = read_conversation_files(path)?;
    let mut out = Vec::new();
    for bytes in files {
        if kind == "chatgpt" {
            let convs: Vec<GptConv> = serde_json::from_slice(&bytes)
                .map_err(|e| format!("Fichier ChatGPT illisible : {e}"))?;
            for c in convs {
                let id = match c.conversation_id.or(c.id) {
                    Some(id) => id,
                    None => continue,
                };
                let mut msgs: Vec<(f64, String)> = Vec::new();
                for node in c.mapping.unwrap_or_default().into_values() {
                    if let Some(m) = node.message {
                        let is_user = m.author.and_then(|a| a.role).as_deref() == Some("user");
                        if !is_user {
                            continue;
                        }
                        let t = as_f64(&m.create_time).unwrap_or(0.0);
                        let text = m
                            .content
                            .and_then(|c| c.parts)
                            .unwrap_or_default()
                            .into_iter()
                            .filter_map(|p| p.as_str().map(|s| s.to_string()))
                            .collect::<Vec<_>>()
                            .join(" ");
                        if !text.trim().is_empty() {
                            msgs.push((t, text));
                        }
                    }
                }
                msgs.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
                let mut text = String::new();
                for (_, m) in msgs {
                    push_limited(&mut text, m.trim());
                }
                let updated = as_f64(&c.update_time).or(as_f64(&c.create_time));
                out.push(Conversation {
                    id,
                    title: c.title.unwrap_or_else(|| "Sans titre".into()),
                    updated_ms: updated.map(|t| t * 1000.0),
                    updated_iso: None,
                    text,
                });
            }
        } else {
            let convs: Vec<ClaudeConv> = serde_json::from_slice(&bytes)
                .map_err(|e| format!("Fichier Claude illisible : {e}"))?;
            for c in convs {
                let id = match c.uuid {
                    Some(id) => id,
                    None => continue,
                };
                let mut text = String::new();
                for m in c.chat_messages.unwrap_or_default() {
                    if m.sender.as_deref() == Some("human") {
                        if let Some(t) = m.text {
                            if !t.trim().is_empty() {
                                push_limited(&mut text, t.trim());
                            }
                        }
                    }
                }
                let title = c.name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| "Sans titre".into());
                out.push(Conversation {
                    id,
                    title,
                    updated_ms: None,
                    updated_iso: c.updated_at.or(c.created_at),
                    text,
                });
            }
        }
    }
    Ok(out)
}

/// Lit un petit fichier choisi par l'utilisateur : identifiants Google (.json)
/// ou export chiffré de la configuration Shorteo (.shorteo).
#[tauri::command]
fn read_json_file(path: String) -> Result<String, String> {
    let lower = path.to_lowercase();
    if !lower.ends_with(".json") && !lower.ends_with(".shorteo") {
        return Err("Choisissez un fichier .json ou .shorteo".into());
    }
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > 256 * 1024 {
        return Err("Fichier trop volumineux".into());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Enregistre l'export chiffré de la configuration (extension .shorteo uniquement).
#[tauri::command]
fn write_export_file(path: String, content: String) -> Result<(), String> {
    if !path.to_lowercase().ends_with(".shorteo") {
        return Err("Le fichier doit avoir l'extension .shorteo".into());
    }
    if content.len() > 256 * 1024 {
        return Err("Contenu trop volumineux".into());
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn import_ai_history(path: String, kind: String) -> Result<Vec<Conversation>, String> {
    tauri::async_runtime::spawn_blocking(move || import_history_blocking(&path, &kind))
        .await
        .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

fn read_startup_settings(app: &AppHandle) -> (String, bool, bool) {
    let path = data_dir(app).ok().map(|d| d.join("settings.json"));
    let raw = path.as_ref().and_then(|p| fs::read_to_string(p).ok());
    let first_run = raw.is_none();
    let v: serde_json::Value = raw
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::Value::Null);
    let shortcut = v
        .get("shortcut")
        .and_then(|x| x.as_str())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(DEFAULT_SHORTCUT)
        .to_string();
    let hide = v.get("hideOnBlur").and_then(|x| x.as_bool()).unwrap_or(true);
    (shortcut, hide, first_run)
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open_i = MenuItem::with_id(app, "open", "Ouvrir Shorteo", true, None::<&str>)?;
    let settings_i = MenuItem::with_id(app, "settings", "Paramètres", true, None::<&str>)?;
    let sync_i = MenuItem::with_id(app, "sync", "Synchroniser maintenant", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_i, &settings_i, &sync_i, &sep, &quit_i])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Shorteo")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_window(app),
            "settings" => {
                show_window(app);
                let _ = app.emit("open-settings", ());
            }
            "sync" => {
                let _ = app.emit("sync-now", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let http = reqwest::Client::builder()
        .user_agent(concat!("Shorteo/", env!("CARGO_PKG_VERSION")))
        .gzip(true)
        .build()
        .expect("client HTTP");

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_window(app);
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_window(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            shortcut: Mutex::new(None),
            shortcut_error: Mutex::new(None),
            hide_on_blur: Mutex::new(true),
            blur_suspended: Mutex::new(false),
            oauth: Mutex::new(None),
            sys: Mutex::new(sysinfo::System::new()),
            http,
            native_log: Mutex::new(std::collections::VecDeque::new()),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let (shortcut, hide, first_run) = read_startup_settings(&handle);
            {
                let state = handle.state::<AppState>();
                *state.hide_on_blur.lock().unwrap() = hide;
                match register_shortcut(&handle, &shortcut) {
                    Ok(sc) => *state.shortcut.lock().unwrap() = Some(sc),
                    Err(e) => {
                        *state.shortcut_error.lock().unwrap() = Some(e);
                        if shortcut != DEFAULT_SHORTCUT {
                            if let Ok(sc) = register_shortcut(&handle, DEFAULT_SHORTCUT) {
                                *state.shortcut.lock().unwrap() = Some(sc);
                            }
                        }
                    }
                }
            }
            build_tray(&handle)?;
            if first_run {
                show_window(&handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Focused(false) => {
                // Vérification différée : on ne masque que si une autre application
                // est réellement passée au premier plan (pas pendant un déplacement).
                let app = window.app_handle().clone();
                let label = window.label().to_string();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(160));
                    let state = app.state::<AppState>();
                    let hide = *state.hide_on_blur.lock().unwrap();
                    let suspended = *state.blur_suspended.lock().unwrap();
                    if !hide || suspended {
                        return;
                    }
                    if let Some(w) = app.get_webview_window(&label) {
                        if !w.is_visible().unwrap_or(false) || is_foreground(&w) {
                            return;
                        }
                        let _ = w.hide();
                        let _ = w.emit("window-hidden", ());
                    }
                });
            }
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            hide_window,
            show_main_window,
            suspend_blur,
            quit_app,
            settings_load,
            settings_save,
            index_load,
            index_save,
            index_clear,
            secret_get,
            secret_set,
            secret_delete,
            apps_status,
            open_url,
            set_shortcut,
            shortcut_status,
            http_request,
            oauth_prepare,
            oauth_wait,
            read_json_file,
            write_export_file,
            native_search,
            native_log,
            native_log_clear,
            import_ai_history
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Shorteo");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lecture_seule() {
        let get = reqwest::Method::GET;
        let post = reqwest::Method::POST;
        let put = reqwest::Method::PUT;
        assert!(method_allowed(&get, "https://yateo.pipedrive.com/api/v2/deals", None));
        assert!(!method_allowed(&post, "https://yateo.pipedrive.com/api/v2/deals", Some("{}")));
        assert!(!method_allowed(&put, "https://api.notion.com/v1/pages/x", None));
        assert!(method_allowed(&post, "https://api.notion.com/v1/search", Some("{}")));
        assert!(!method_allowed(&post, "https://api.notion.com/v1/pages", Some("{}")));
        assert!(method_allowed(&post, "https://oauth2.googleapis.com/token", None));
        assert!(!method_allowed(&post, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", None));
        assert!(method_allowed(&post, "https://mcp.notion.com/token", None));
        assert!(method_allowed(&post, "https://mcp.notion.com/register", None));
        let search = r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"notion-search","arguments":{"query":"x"}}}"#;
        let create = r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"notion-create-pages","arguments":{}}}"#;
        let init = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#;
        assert!(method_allowed(&post, "https://mcp.notion.com/mcp", Some(search)));
        assert!(method_allowed(&post, "https://mcp.notion.com/mcp", Some(init)));
        assert!(!method_allowed(&post, "https://mcp.notion.com/mcp", Some(create)));
        let favs = r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"notion-list-favorite-pages","arguments":{}}}"#;
        let fav_edit = r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"notion-update-page-favorites","arguments":{}}}"#;
        assert!(method_allowed(&post, "https://mcp.notion.com/mcp", Some(favs)));
        assert!(!method_allowed(&post, "https://mcp.notion.com/mcp", Some(fav_edit)));
        assert!(!method_allowed(&post, "https://mcp.notion.com/mcp", Some("pas du json")));
        // Drive : liste des drives partagés et racine de « Mon Drive » en lecture
        assert!(method_allowed(&get, "https://www.googleapis.com/drive/v3/drives?pageSize=100", None));
        assert!(!method_allowed(&post, "https://www.googleapis.com/drive/v3/drives", Some("{}")));
    }

    #[test]
    fn choix_de_la_fenetre_principale() {
        let big = WinCand { w: 1400, h: 900, ..Default::default() };
        // mini-fenêtre de recherche « toujours au-dessus », plus haute dans la pile : écartée
        let popup = WinCand { w: 700, h: 420, topmost: true, ..Default::default() };
        assert_eq!(pick_window(&[popup.clone(), big.clone()]), Some(1));
        // palette, petite fenêtre, fenêtre possédée : écartées
        let tool = WinCand { w: 1200, h: 800, tool: true, ..Default::default() };
        let small = WinCand { w: 160, h: 40, ..Default::default() };
        let owned = WinCand { w: 1200, h: 800, owned: true, ..Default::default() };
        assert_eq!(pick_window(&[tool, small, owned, big.clone()]), Some(3));
        // fenêtre réduite (taille factice) : acceptée
        let min = WinCand { w: 160, h: 28, iconic: true, ..Default::default() };
        assert_eq!(pick_window(&[min]), Some(0));
        // seule une fenêtre « toujours au-dessus » : prise faute de mieux
        assert_eq!(pick_window(&[popup]), Some(0));
        assert_eq!(pick_window(&[]), None);
    }
}
