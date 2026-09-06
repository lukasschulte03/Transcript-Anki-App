// Google treats an OAuth secret for an installed desktop client as public
// client configuration: it cannot be kept secret once the app is distributed.
// Keep it out of source control nonetheless. Release builds made by the
// maintainer read it from Windows Credential Manager and compile it into the
// desktop binary; local development keeps the runtime credential fallback.
fn main() {
    println!("cargo::rustc-check-cfg=cfg(mobile)");
    println!("cargo:rerun-if-changed=build.rs");
    let Ok(entry) = keyring::Entry::new("Lectio", "google-drive-client-secret") else {
        return;
    };
    let Ok(secret) = entry.get_password() else {
        return;
    };
    if !secret.trim().is_empty() {
        println!("cargo:rustc-env=LECTIO_GOOGLE_DRIVE_CLIENT_SECRET={secret}");
    }
}
