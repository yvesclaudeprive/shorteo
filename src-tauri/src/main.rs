// Pas de console noire au lancement sous Windows (en version finale).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    shorteo_lib::run()
}
