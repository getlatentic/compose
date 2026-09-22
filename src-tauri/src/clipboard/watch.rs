//! Noticing copies. macOS announces none, so the clipboard's change counter is
//! read twice a second — on the main thread, where AppKit's pasteboard belongs —
//! and only while history is on. What changed is kept off the main thread.

use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use super::copy::{to_item, Copy};
use super::{mac, ClipboardHistory, CHANGED_EVENT, KEEP};
use crate::db::MetadataStore;

const POLL: Duration = Duration::from_millis(500);

pub(super) fn start(app: AppHandle) {
    let (sender, received) = mpsc::channel::<Copy>();
    let keeper = app.clone();
    std::thread::spawn(move || {
        for copy in received {
            keep(&keeper, copy);
        }
    });
    // What was on the clipboard before Compose started is not a new copy.
    let starter = app.clone();
    let _ = app.run_on_main_thread(move || {
        starter.state::<ClipboardHistory>().seen.store(mac::change_count(), Ordering::SeqCst);
    });
    std::thread::spawn(move || loop {
        std::thread::sleep(POLL);
        if !app.state::<ClipboardHistory>().enabled.load(Ordering::SeqCst) {
            continue;
        }
        let sender = sender.clone();
        let reader = app.clone();
        let _ = app.run_on_main_thread(move || {
            let count = mac::change_count();
            if reader.state::<ClipboardHistory>().seen.swap(count, Ordering::SeqCst) != count {
                let _ = sender.send(mac::read());
            }
        });
    });
}

fn keep(app: &AppHandle, copy: Copy) {
    let Some(item) = to_item(copy) else { return };
    let id = uuid::Uuid::new_v4().to_string();
    match app.state::<MetadataStore>().remember_copy(&item, &id, KEEP) {
        Ok(_) => {
            let _ = app.emit(CHANGED_EVENT, ());
        }
        Err(error) => eprintln!("clipboard history: {error}"),
    }
}
