// Google treats an OAuth secret for an installed desktop client as public
// client configuration: it cannot be kept secret once the app is distributed.
// Keep it out of source control nonetheless. Release builds made by the
// maintainer read it from Windows Credential Manager and compile it into the
// desktop binary; local development keeps the runtime credential fallback.
fn main() {
    println!("cargo::rustc-check-cfg=cfg(mobile)");
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=capabilities");
    println!("cargo:rerun-if-changed=tauri.conf.json");

    // Do not return early here. Tauri's build hook embeds capabilities and
    // permissions in the executable; skipping it leaves the frontend APIs
    // present but denied at runtime ("Plugin not found").
    if let Ok(entry) = keyring::Entry::new("Lectio", "google-drive-client-secret") {
        if let Ok(secret) = entry.get_password() {
            if !secret.trim().is_empty() {
                println!("cargo:rustc-env=LECTIO_GOOGLE_DRIVE_CLIENT_SECRET={secret}");
            }
        }
    }

    tauri_build::build();
}
