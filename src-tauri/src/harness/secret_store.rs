//! One secret store, three operating systems.
//!
//! The OS vault holds a single 32-byte master key. Every provider secret lives
//! in one file next to the app's config, encrypted with that key. This is the
//! shape VS Code uses, and it is chosen for a specific reason: a vault entry
//! per secret only works where a vault reliably exists. macOS always has the
//! Keychain and Windows always has the Credential Manager, but a Linux desktop
//! may have libsecret, kwallet, or nothing at all. Keeping the secrets in a
//! file we encrypt ourselves means the file is byte-identical everywhere and
//! only the *key* needs a platform-specific home.
//!
//! It also has a smaller benefit that matters on macOS. A keychain item's ACL
//! is bound to the code signature that created it, so an ad-hoc-signed
//! development build is a stranger to items written by a signed release and
//! its reads are blocked. With one item instead of one per provider, that
//! failure is one prompt rather than several — and adding a provider stops
//! touching the vault at all.
//!
//! The key is per-machine and there is no passphrase, so the store is invisible
//! in normal use — no prompt on read, which is the whole point. The cost is
//! that losing the key (a wiped keychain, a restored backup, a new machine)
//! makes the file undecryptable. That is recoverable only by re-entering the
//! secrets, so [`SecretStore::load`] reports it as its own outcome rather than
//! a generic error, and the caller says so in those words.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use base64::Engine as _;
use chacha20poly1305::aead::{Aead, KeyInit, OsRng};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

/// The vault entry holding the master key. One entry, whatever the platform.
const KEYRING_SERVICE: &str = "ai.latentic.compose";
const KEYRING_ACCOUNT: &str = "credential-store-key";
/// The encrypted file, alongside the app's other config.
const STORE_FILE: &str = "credentials.enc";

const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 24;

/// What happened when the store was opened.
///
/// `KeyLost` is separated from the error cases deliberately. It is not a fault
/// the user can debug; it means the secrets are gone and must be typed again.
/// Collapsing it into "could not read credentials" would leave someone
/// retrying a thing that will never succeed.
#[derive(Debug)]
pub enum Opened {
    /// Decrypted, with whatever it held (empty on first run).
    Ready(SecretStore),
    /// The file exists but the master key that encrypted it does not. The
    /// secrets are unrecoverable; the user re-enters them.
    KeyLost,
}

/// The on-disk envelope. The ciphertext is a JSON map of id → secret.
#[derive(Serialize, Deserialize)]
struct Envelope {
    /// Bumped only for a format change that old builds cannot read.
    version: u8,
    /// Base64. Random per write — XChaCha20's nonce is wide enough that random
    /// generation needs no counter to stay collision-free.
    nonce: String,
    /// Base64.
    ciphertext: String,
}

pub struct SecretStore {
    path: PathBuf,
    key: [u8; KEY_LEN],
    secrets: BTreeMap<String, String>,
}

/// Redacting by construction: a store must never be printable into a log.
/// Names are safe — they are provider ids — but no value or key material.
impl std::fmt::Debug for SecretStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SecretStore").field("secrets", &self.secrets.len()).finish()
    }
}

impl Drop for SecretStore {
    fn drop(&mut self) {
        self.key.zeroize();
    }
}

impl SecretStore {
    /// Open the store for `config_dir`, creating the master key on first use.
    pub fn load(config_dir: &Path) -> Result<Opened, String> {
        let path = config_dir.join(STORE_FILE);
        let existing = read_envelope(&path)?;

        Ok(match decide(read_master_key()?, existing.as_ref()) {
            Decision::Ready { key, secrets } => Opened::Ready(Self { path, key, secrets }),
            Decision::KeyLost => Opened::KeyLost,
            Decision::Mint => {
                let key = new_master_key();
                write_master_key(&key)?;
                Opened::Ready(Self { path, key, secrets: BTreeMap::new() })
            }
        })
    }

    pub fn get(&self, id: &str) -> Option<&str> {
        self.secrets.get(id).map(String::as_str)
    }

    /// Store a secret, or remove it when `value` is empty.
    pub fn set(&mut self, id: &str, value: &str) -> Result<(), String> {
        let value = value.trim();
        if value.is_empty() {
            self.secrets.remove(id);
        } else {
            self.secrets.insert(id.to_owned(), value.to_owned());
        }
        self.persist()
    }

    /// Drop every secret and the master key with them — the "reset all data"
    /// path. Removing the key as well means a leftover file cannot be read by
    /// a future install that happens to reuse the directory.
    pub fn clear(&mut self) -> Result<(), String> {
        self.secrets.clear();
        if self.path.exists() {
            std::fs::remove_file(&self.path).map_err(|e| format!("could not remove store: {e}"))?;
        }
        delete_master_key();
        Ok(())
    }

    fn persist(&self) -> Result<(), String> {
        // Nothing left to protect — remove the file rather than leave an
        // encrypted empty map behind.
        if self.secrets.is_empty() {
            if self.path.exists() {
                std::fs::remove_file(&self.path)
                    .map_err(|e| format!("could not remove store: {e}"))?;
            }
            return Ok(());
        }
        let envelope = encrypt(&self.key, &self.secrets)?;
        let json = serde_json::to_vec(&envelope).map_err(|e| e.to_string())?;
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&self.path, json).map_err(|e| format!("could not write store: {e}"))?;
        restrict_permissions(&self.path);
        Ok(())
    }
}

/// What opening the store should do, given only the key the vault returned and
/// whatever is on disk.
///
/// Split out because it is the security decision and the rest is I/O: reading
/// the vault needs an OS keychain, so with the two together not one branch of
/// this table could be exercised. The dangerous branch is a file with no key —
/// minting one there would overwrite the only key that could ever open it.
#[cfg_attr(test, derive(Debug))]
enum Decision {
    Ready { key: [u8; KEY_LEN], secrets: BTreeMap<String, String> },
    KeyLost,
    /// No key and nothing to lose.
    Mint,
}

fn decide(key: Option<[u8; KEY_LEN]>, existing: Option<&Envelope>) -> Decision {
    match (key, existing) {
        (Some(key), Some(envelope)) => match decrypt(&key, envelope) {
            Ok(secrets) => Decision::Ready { key, secrets },
            // The key exists but does not open this file: a stale file from a
            // previous install, or a rotated key. Same remedy as a lost key, so
            // report it the same way rather than failing the boot.
            Err(_) => Decision::KeyLost,
        },
        (Some(key), None) => Decision::Ready { key, secrets: BTreeMap::new() },
        (None, Some(_)) => Decision::KeyLost,
        (None, None) => Decision::Mint,
    }
}

fn read_envelope(path: &Path) -> Result<Option<Envelope>, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice::<Envelope>(&bytes)
            .map(Some)
            .map_err(|e| format!("credential store is corrupt: {e}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("could not read credential store: {error}")),
    }
}

fn encrypt(key: &[u8; KEY_LEN], secrets: &BTreeMap<String, String>) -> Result<Envelope, String> {
    let plaintext = serde_json::to_vec(secrets).map_err(|e| e.to_string())?;
    let cipher = XChaCha20Poly1305::new(key.into());
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(&nonce), plaintext.as_slice())
        .map_err(|_| "could not encrypt credentials".to_owned())?;
    let b64 = base64::engine::general_purpose::STANDARD;
    Ok(Envelope {
        version: 1,
        nonce: b64.encode(nonce),
        ciphertext: b64.encode(ciphertext),
    })
}

fn decrypt(key: &[u8; KEY_LEN], envelope: &Envelope) -> Result<BTreeMap<String, String>, String> {
    if envelope.version != 1 {
        return Err(format!("unsupported store version {}", envelope.version));
    }
    let b64 = base64::engine::general_purpose::STANDARD;
    let nonce = b64.decode(&envelope.nonce).map_err(|e| e.to_string())?;
    let ciphertext = b64.decode(&envelope.ciphertext).map_err(|e| e.to_string())?;
    if nonce.len() != NONCE_LEN {
        return Err("bad nonce length".to_owned());
    }
    let cipher = XChaCha20Poly1305::new(key.into());
    let plaintext = cipher
        .decrypt(XNonce::from_slice(&nonce), ciphertext.as_slice())
        .map_err(|_| "could not decrypt credentials".to_owned())?;
    serde_json::from_slice(&plaintext).map_err(|e| e.to_string())
}

fn new_master_key() -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key);
    key
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("no OS credential store available: {e}"))
}

fn read_master_key() -> Result<Option<[u8; KEY_LEN]>, String> {
    let entry = entry()?;
    match entry.get_password() {
        Ok(encoded) => {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(encoded.trim())
                .map_err(|e| format!("master key is malformed: {e}"))?;
            let key: [u8; KEY_LEN] = bytes
                .try_into()
                .map_err(|_| "master key is the wrong length".to_owned())?;
            Ok(Some(key))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("could not read the master key: {error}")),
    }
}

fn write_master_key(key: &[u8; KEY_LEN]) -> Result<(), String> {
    let encoded = base64::engine::general_purpose::STANDARD.encode(key);
    entry()?
        .set_password(&encoded)
        .map_err(|e| format!("could not save the master key: {e}"))
}

fn delete_master_key() {
    if let Ok(entry) = entry() {
        let _ = entry.delete_credential();
    }
}

/// Owner-only on Unix. The file is encrypted regardless; this just keeps it out
/// of reach of other accounts on a shared machine. Windows inherits the user's
/// profile ACL, so there is nothing to set.
#[cfg(unix)]
fn restrict_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    /// Exercise the crypto without touching the OS vault — a test must not
    /// write to the developer's real keychain.
    fn store_at(dir: &Path, key: [u8; KEY_LEN]) -> SecretStore {
        SecretStore { path: dir.join(STORE_FILE), key, secrets: BTreeMap::new() }
    }

    fn envelope_for(key: [u8; KEY_LEN], pairs: &[(&str, &str)]) -> Envelope {
        let secrets: BTreeMap<String, String> =
            pairs.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect();
        encrypt(&key, &secrets).expect("seals")
    }

    #[test]
    fn a_file_with_no_key_is_never_reopened_by_minting_a_new_one() {
        // The dangerous branch. Minting here would write a fresh key over the
        // only one that could ever open this file, turning "your keychain was
        // wiped, restore it" into "your secrets are gone" — permanently, and
        // silently, on the next boot.
        let sealed = envelope_for([7u8; KEY_LEN], &[("openrouter", "sk-live")]);
        assert!(matches!(decide(None, Some(&sealed)), Decision::KeyLost));
    }

    #[test]
    fn a_first_run_mints_a_key_and_a_later_one_does_not() {
        // No key and no file is the only case where minting is right.
        assert!(matches!(decide(None, None), Decision::Mint));

        // With a key in hand and nothing on disk, the store opens empty rather
        // than minting a second key over the first.
        match decide(Some([3u8; KEY_LEN]), None) {
            Decision::Ready { key, secrets } => {
                assert_eq!(key, [3u8; KEY_LEN], "the vault's key is kept");
                assert!(secrets.is_empty());
            }
            other => panic!("expected Ready, got {other:?}"),
        }
    }

    #[test]
    fn the_right_key_opens_the_file_and_a_rotated_one_reports_it_as_lost() {
        let key = [9u8; KEY_LEN];
        let sealed = envelope_for(key, &[("openrouter", "sk-live")]);

        match decide(Some(key), Some(&sealed)) {
            Decision::Ready { secrets, .. } => {
                assert_eq!(secrets.get("openrouter").map(String::as_str), Some("sk-live"));
            }
            other => panic!("expected Ready, got {other:?}"),
        }

        // A key that does not open this file has the same remedy as no key at
        // all: re-enter the secrets. Failing the boot instead would leave the
        // user with an app that will not start and no way to fix it.
        assert!(matches!(decide(Some([1u8; KEY_LEN]), Some(&sealed)), Decision::KeyLost));
    }

    #[test]
    fn a_secret_is_trimmed_before_it_is_stored() {
        // Keys get pasted with a trailing newline. Sending that to a provider
        // fails as "unauthorized", which reads as a wrong key rather than a
        // stray byte.
        let dir = tempfile::tempdir().expect("tempdir");
        let mut store = store_at(dir.path(), [5u8; KEY_LEN]);
        store.set("openrouter", "  sk-live\n").expect("write");
        assert_eq!(store.get("openrouter"), Some("sk-live"));

        store.set("blank", "   ").expect("whitespace only");
        assert_eq!(store.get("blank"), None, "whitespace is not a secret");
    }

    #[test]
    fn the_store_never_prints_what_it_holds() {
        // `SecretStore` is reachable from state that gets logged on a panic.
        // Asserting only that the secret is absent is satisfied by printing
        // nothing at all, so the count has to be asserted too — otherwise the
        // redaction and a broken Debug impl look identical.
        let dir = tempfile::tempdir().expect("tempdir");
        let mut store = store_at(dir.path(), [5u8; KEY_LEN]);
        store.set("openrouter", "sk-super-secret").expect("write");

        let shown = format!("{store:?}");
        assert!(!shown.contains("sk-super-secret"), "secret leaked into Debug: {shown}");
        assert!(shown.contains("SecretStore"), "still identifies itself: {shown}");
        assert!(shown.contains('1'), "and says how many it holds: {shown}");
    }

    #[test]
    fn no_store_on_disk_is_an_empty_store_not_a_failure() {
        // First launch. Reading a missing file has to be "nothing yet"; an
        // error here fails the boot for every new user.
        let dir = tempfile::tempdir().expect("tempdir");
        let absent = read_envelope(&dir.path().join(STORE_FILE)).expect("not an error");
        assert!(absent.is_none());

        // A file that exists but cannot be parsed is a different answer: the
        // user has a store and we could not read it, which is worth saying.
        std::fs::write(dir.path().join(STORE_FILE), b"not json").expect("write");
        assert!(read_envelope(&dir.path().join(STORE_FILE)).is_err(), "corrupt is reported");
    }

    #[cfg(unix)]
    #[test]
    fn a_store_we_cannot_read_is_not_an_empty_store() {
        // Only *absent* means "nothing yet". A file that exists and will not
        // open — wrong owner after a restore, a permissions change — has to be
        // an error. Collapsed into `Ok(None)` the app starts with no secrets,
        // silently, and the first write replaces the file the user still had.
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join(STORE_FILE);
        std::fs::write(&path, b"{}").expect("write");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).expect("chmod");

        let outcome = read_envelope(&path);

        // Restore before asserting, so a failure cannot leave an unremovable
        // temp dir behind.
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).expect("chmod");
        assert!(outcome.is_err(), "unreadable must not read as absent");
    }

    #[test]
    fn clearing_removes_the_file_as_well_as_the_secrets() {
        // "Reset all data". `set("")` on the last secret also removes the file,
        // so only `clear` covers the case where several remain.
        let dir = tempfile::tempdir().expect("tempdir");
        let mut store = store_at(dir.path(), [5u8; KEY_LEN]);
        store.set("openrouter", "sk-a").expect("write");
        store.set("anthropic", "sk-b").expect("write");
        assert!(dir.path().join(STORE_FILE).exists());

        store.clear().expect("clear");
        assert_eq!(store.get("openrouter"), None);
        assert_eq!(store.get("anthropic"), None);
        assert!(!dir.path().join(STORE_FILE).exists(), "the file goes too");
    }

    #[test]
    fn a_secret_survives_a_write_and_read() {
        let dir = tempfile::tempdir().unwrap();
        let key = new_master_key();
        let mut store = store_at(dir.path(), key);
        store.set("openrouter", "sk-or-v1-example").unwrap();

        let envelope = read_envelope(&dir.path().join(STORE_FILE)).unwrap().unwrap();
        let round_tripped = decrypt(&key, &envelope).unwrap();
        assert_eq!(round_tripped.get("openrouter").map(String::as_str), Some("sk-or-v1-example"));
    }

    #[test]
    fn the_file_never_contains_the_secret_in_clear() {
        // The point of the exercise: someone reading the file, or a backup of
        // it, learns nothing.
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_at(dir.path(), new_master_key());
        store.set("openrouter", "sk-or-v1-SENTINEL").unwrap();

        let raw = std::fs::read_to_string(dir.path().join(STORE_FILE)).unwrap();
        assert!(!raw.contains("sk-or-v1-SENTINEL"));
        assert!(!raw.contains("SENTINEL"));
    }

    #[test]
    fn a_different_key_cannot_open_the_file() {
        // The lost-key case, which the caller reports as "re-enter your keys".
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_at(dir.path(), new_master_key());
        store.set("openrouter", "sk-or-v1-example").unwrap();

        let envelope = read_envelope(&dir.path().join(STORE_FILE)).unwrap().unwrap();
        assert!(decrypt(&new_master_key(), &envelope).is_err());
    }

    #[test]
    fn every_write_uses_a_fresh_nonce() {
        // Reusing a nonce with the same key breaks XChaCha20-Poly1305 outright,
        // so this is the one crypto invariant worth pinning.
        let dir = tempfile::tempdir().unwrap();
        let key = new_master_key();
        let mut store = store_at(dir.path(), key);

        store.set("a", "one").unwrap();
        let first = read_envelope(&dir.path().join(STORE_FILE)).unwrap().unwrap().nonce;
        store.set("b", "two").unwrap();
        let second = read_envelope(&dir.path().join(STORE_FILE)).unwrap().unwrap().nonce;

        assert_ne!(first, second);
    }

    #[test]
    fn clearing_the_last_secret_removes_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = store_at(dir.path(), new_master_key());
        store.set("openrouter", "sk-or-v1-example").unwrap();
        assert!(dir.path().join(STORE_FILE).exists());

        store.set("openrouter", "").unwrap();
        assert!(!dir.path().join(STORE_FILE).exists(), "an empty store leaves nothing behind");
    }

    #[test]
    fn many_providers_share_one_file() {
        // The reason for the change: adding a provider must not add a vault
        // entry.
        let dir = tempfile::tempdir().unwrap();
        let key = new_master_key();
        let mut store = store_at(dir.path(), key);
        store.set("openrouter", "sk-or").unwrap();
        store.set("custom:openai:a", "sk-a").unwrap();
        store.set("custom:openai:b", "sk-b").unwrap();

        let envelope = read_envelope(&dir.path().join(STORE_FILE)).unwrap().unwrap();
        let all = decrypt(&key, &envelope).unwrap();
        assert_eq!(all.len(), 3);
    }

    #[test]
    fn a_corrupt_file_is_reported_not_ignored() {
        // Silently starting empty would look like "my keys vanished" with no
        // explanation, and would then overwrite whatever was there.
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(STORE_FILE), b"not json").unwrap();
        assert!(read_envelope(&dir.path().join(STORE_FILE)).is_err());
    }
}
