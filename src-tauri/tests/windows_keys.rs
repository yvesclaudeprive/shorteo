//! Test réel sous Windows de la saisie automatique (utilisée pour lancer la recherche
//! dans Notion, Superhuman, Pipedrive, Claude et ChatGPT) : on lance le Bloc-notes,
//! on vérifie qu'il est trouvé et au premier plan, puis on tape « / » et colle une
//! requête, et on relit le texte obtenu.
#![cfg(windows)]

use shorteo_lib::{keys, winapp};
use std::process::Command;
use std::thread::sleep;
use std::time::{Duration, Instant};

fn set_clipboard(text: &str) {
    let ok = Command::new("powershell")
        .args(["-NoProfile", "-Command", &format!("Set-Clipboard -Value '{text}'")])
        .status()
        .expect("powershell");
    assert!(ok.success(), "Set-Clipboard a échoué");
}

fn get_clipboard() -> String {
    let out = Command::new("powershell")
        .args(["-NoProfile", "-Command", "Get-Clipboard -Raw"])
        .output()
        .expect("powershell");
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

#[test]
#[ignore = "nécessite un bureau Windows interactif (lancé en CI)"]
fn bloc_notes_premier_plan_frappe_et_collage() {
    let mut sys = sysinfo::System::new();
    let mut child = Command::new("notepad.exe").spawn().expect("lancement du Bloc-notes");

    // 1. la fenêtre du Bloc-notes est trouvée
    let deadline = Instant::now() + Duration::from_secs(20);
    let hwnd = loop {
        let pids = winapp::pids(&mut sys, "notepad.exe");
        if let Some(h) = winapp::find_window(&pids) {
            break h;
        }
        assert!(Instant::now() < deadline, "fenêtre du Bloc-notes introuvable");
        sleep(Duration::from_millis(200));
    };

    // 2. elle est au premier plan
    winapp::focus(hwnd);
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let pids = winapp::pids(&mut sys, "notepad.exe");
        if pids.contains(&winapp::foreground_pid()) {
            break;
        }
        assert!(Instant::now() < deadline, "le Bloc-notes n'est pas passé au premier plan");
        sleep(Duration::from_millis(200));
    }
    sleep(Duration::from_millis(800));
    assert!(!winapp::foreground_title().is_empty(), "titre de la fenêtre au premier plan vide");
    assert!(keys::wait_modifiers_released(Duration::from_secs(2)), "touches Ctrl/Maj/Alt vues comme enfoncées");

    // 3. Échap (sans effet), « / » tapé selon le clavier actuel, collage, puis un mot
    //    tapé lettre par lettre (variante palette de Superhuman)
    set_clipboard("to:hanane");
    assert!(keys::tap(keys::ESCAPE) > 0, "SendInput a refusé Échap");
    sleep(Duration::from_millis(200));
    assert!(keys::type_char('/') > 0, "SendInput a refusé la frappe");
    sleep(Duration::from_millis(300));
    keys::ctrl(keys::K_V);
    sleep(Duration::from_millis(400));
    assert!(keys::type_text(" search") > 0, "SendInput a refusé le mot");
    sleep(Duration::from_millis(300));
    // touche de recherche de Superhuman : « / » américain (« : » en AZERTY), SANS Maj
    assert!(keys::tap(keys::SEARCH_KEY) > 0, "SendInput a refusé la touche de recherche");
    sleep(Duration::from_millis(500));

    // 4. relecture : tout sélectionner + copier
    set_clipboard("vide");
    keys::ctrl(keys::K_A);
    sleep(Duration::from_millis(300));
    keys::ctrl(keys::K_C);
    sleep(Duration::from_millis(600));
    let text = get_clipboard();

    let _ = child.kill();
    let _ = Command::new("taskkill").args(["/F", "/IM", "notepad.exe"]).status();
    // clavier américain (CI) : « / » ; AZERTY : « : » — jamais « ? » (= Maj enfoncée)
    let (body, last) = text.split_at(text.len() - 1);
    assert_eq!(body, "/to:hanane search", "texte obtenu dans le Bloc-notes : {text}");
    assert!(last == "/" || last == ":", "touche de recherche : « {last} » au lieu de « / » ou « : »");
}

/// Les raccourcis proposés par défaut sont libres sur un Windows standard :
/// Windows accepte de les réserver (RegisterHotKey échoue si un autre programme les a pris).
#[test]
#[ignore = "nécessite un bureau Windows interactif (lancé en CI)"]
fn raccourcis_par_defaut_libres_sous_windows() {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        RegisterHotKey, UnregisterHotKey, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT,
    };
    let all = MOD_CONTROL | MOD_ALT | MOD_SHIFT | MOD_NOREPEAT;
    let list: &[(&str, u32, u32)] = &[
        ("Ctrl+Maj+Espace (général)", MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, 0x20),
        ("Ctrl+Maj+Alt+N (Notion)", all, 0x4E),
        ("Ctrl+Maj+Alt+D (Drive)", all, 0x44),
        ("Ctrl+Maj+Alt+P (Pipedrive)", all, 0x50),
        ("Ctrl+Maj+Alt+M (Mails)", all, 0x4D),
        ("Ctrl+Maj+Alt+G (ChatGPT)", all, 0x47),
        ("Ctrl+Maj+Alt+C (Claude)", all, 0x43),
    ];
    for (i, (name, mods, vk)) in list.iter().enumerate() {
        let id = 0x5000 + i as i32;
        let ok = unsafe { RegisterHotKey(std::ptr::null_mut(), id, *mods, *vk) };
        assert!(ok != 0, "{name} est déjà pris sous Windows");
        unsafe { UnregisterHotKey(std::ptr::null_mut(), id) };
        println!("{name} : libre");
    }
}
