//! Spotlight's index, and opening a note when its result is chosen.

use std::sync::{mpsc, OnceLock};
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
use objc2::{sel, AnyThread, MainThreadMarker};
use objc2_app_kit::NSApplication;
use objc2_core_spotlight::{
    CSSearchableIndex, CSSearchableItem, CSSearchableItemActionType, CSSearchableItemActivityIdentifier,
    CSSearchableItemAttributeSet,
};
use objc2_foundation::{NSArray, NSDate, NSError, NSString, NSUserActivity};
use objc2_uniform_type_identifiers::{UTType, UTTypePlainText};
use tauri::AppHandle;

use super::indexer::SearchIndex;
use super::note::SearchableNote;

/// Long enough for Spotlight to take a batch on a busy Mac; a reply that never
/// comes fails the job rather than stalling every job behind it.
const REPLY_WAIT: Duration = Duration::from_secs(60);

/// The index every Mac app has for its own items.
pub(super) struct CoreSpotlight;

impl SearchIndex for CoreSpotlight {
    fn index(&self, notes: &[SearchableNote]) -> Result<(), String> {
        let items: Vec<Retained<CSSearchableItem>> = notes.iter().map(item).collect();
        let items = NSArray::from_retained_slice(&items);
        // SAFETY: the items are complete, and the reply block outlives the call.
        wait(|reply| unsafe { index().indexSearchableItems_completionHandler(&items, Some(reply)) })
    }

    fn delete(&self, ids: &[String]) -> Result<(), String> {
        let ids = strings(ids);
        // SAFETY: as in `index`.
        wait(|reply| unsafe { index().deleteSearchableItemsWithIdentifiers_completionHandler(&ids, Some(reply)) })
    }

    fn delete_workspace(&self, workspace_id: &str) -> Result<(), String> {
        let domains = strings(&[workspace_id.to_owned()]);
        // SAFETY: as in `index`.
        wait(|reply| unsafe { index().deleteSearchableItemsWithDomainIdentifiers_completionHandler(&domains, Some(reply)) })
    }

    fn delete_everything(&self) -> Result<(), String> {
        // SAFETY: as in `index`.
        wait(|reply| unsafe { index().deleteAllSearchableItemsWithCompletionHandler(Some(reply)) })
    }
}

pub(super) fn available() -> bool {
    // SAFETY: a class method with no arguments.
    unsafe { CSSearchableIndex::isIndexingAvailable() }
}

fn index() -> Retained<CSSearchableIndex> {
    // SAFETY: as in `available`.
    unsafe { CSSearchableIndex::defaultSearchableIndex() }
}

fn item(note: &SearchableNote) -> Retained<CSSearchableItem> {
    let markdown = UTType::typeWithIdentifier(&NSString::from_str("net.daringfireball.markdown"));
    // SAFETY: an attribute set for a known type, given only strings and a date.
    unsafe {
        let content_type = markdown.as_deref().unwrap_or(UTTypePlainText);
        let attributes = CSSearchableItemAttributeSet::initWithContentType(CSSearchableItemAttributeSet::alloc(), content_type);
        attributes.setTitle(Some(&NSString::from_str(&note.title)));
        attributes.setDisplayName(Some(&NSString::from_str(&note.title)));
        attributes.setContentDescription(Some(&NSString::from_str(&note.summary)));
        attributes.setTextContent(Some(&NSString::from_str(&note.text)));
        attributes.setKeywords(Some(&strings(std::slice::from_ref(&note.workspace_name))));
        attributes.setContentModificationDate(Some(&NSDate::dateWithTimeIntervalSince1970(note.modified_at as f64 / 1000.0)));
        CSSearchableItem::initWithUniqueIdentifier_domainIdentifier_attributeSet(
            CSSearchableItem::alloc(),
            Some(&NSString::from_str(&note.id)),
            Some(&NSString::from_str(&note.workspace_id)),
            &attributes,
        )
    }
}

fn strings(values: &[String]) -> Retained<NSArray<NSString>> {
    let strings: Vec<Retained<NSString>> = values.iter().map(|value| NSString::from_str(value)).collect();
    NSArray::from_retained_slice(&strings)
}

/// Start a call with a reply block and wait for the reply. Called off the main
/// thread, where Core Spotlight may deliver it.
fn wait(start: impl FnOnce(&block2::DynBlock<dyn Fn(*mut NSError)>)) -> Result<(), String> {
    let (sender, replies) = mpsc::channel();
    let reply = RcBlock::new(move |error: *mut NSError| {
        // SAFETY: Core Spotlight passes a valid error or nil.
        let failure = unsafe { error.as_ref() }.map(|error| error.localizedDescription().to_string());
        let _ = sender.send(failure);
    });
    start(&reply);
    match replies.recv_timeout(REPLY_WAIT) {
        Ok(None) => Ok(()),
        Ok(Some(failure)) => Err(failure),
        Err(_) => Err("Spotlight did not answer".to_owned()),
    }
}

type ContinueActivity =
    unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject, *mut NSUserActivity, *mut AnyObject) -> Bool;

static APP: OnceLock<AppHandle> = OnceLock::new();
static TAO_CONTINUE: OnceLock<Imp> = OnceLock::new();

/// Answer a chosen Spotlight result by opening its note. The window library's
/// app delegate already answers `application:continueUserActivity:…` for web
/// links, so its method is taken over and still called for everything else.
pub(super) fn open_results(app: &AppHandle) {
    let _ = APP.set(app.clone());
    let Some(mtm) = MainThreadMarker::new() else {
        eprintln!("Spotlight results: not on the main thread");
        return;
    };
    let Some(delegate) = NSApplication::sharedApplication(mtm).delegate() else {
        return;
    };
    let delegate: &AnyObject = delegate.as_ref();
    let class: &AnyClass = delegate.class();
    let selector = sel!(application:continueUserActivity:restorationHandler:);
    let Some(method) = class.instance_method(selector) else {
        eprintln!("Spotlight results: the app delegate does not continue activities");
        return;
    };
    // SAFETY: the replacement has the signature of the method it replaces.
    let replaced = unsafe { method.set_implementation(std::mem::transmute::<ContinueActivity, Imp>(continue_activity)) };
    let _ = TAO_CONTINUE.set(replaced);
}

unsafe extern "C-unwind" fn continue_activity(
    this: *mut AnyObject,
    cmd: Sel,
    application: *mut AnyObject,
    activity: *mut NSUserActivity,
    restoration: *mut AnyObject,
) -> Bool {
    // SAFETY: AppKit passes the activity being continued.
    if let Some(path) = unsafe { activity.as_ref() }.and_then(chosen_note) {
        if let Some(app) = APP.get() {
            crate::deep_link::open_note(app, &path);
        }
        return Bool::YES;
    }
    match TAO_CONTINUE.get() {
        // SAFETY: the method this one replaced, called as AppKit called this.
        Some(original) => unsafe {
            std::mem::transmute::<Imp, ContinueActivity>(*original)(this, cmd, application, activity, restoration)
        },
        None => Bool::NO,
    }
}

/// The note a chosen Spotlight result names.
fn chosen_note(activity: &NSUserActivity) -> Option<String> {
    // SAFETY: Core Spotlight's constant strings.
    let (action, identifier) = unsafe { (CSSearchableItemActionType, CSSearchableItemActivityIdentifier) };
    if !activity.activityType().isEqualToString(action) {
        return None;
    }
    let value = activity.userInfo()?.objectForKey(identifier.as_ref())?;
    value.downcast_ref::<NSString>().map(ToString::to_string)
}
