//! Keeping the app awake while a clip is filed.
//!
//! Filing a clip crosses the app's main thread several times — the event to the
//! page, and each call back — and App Nap holds a backgrounded app's main
//! thread back. Measured, a clip took several seconds to become a note after
//! minutes in the background, and about thirty after hours, against a third of a
//! second while the app was awake. Sharing is work the user asked for, so the
//! app says so for as long as it takes.

use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Longest one burst of clips keeps the app awake, in case the page never
/// comes back to say the inbox is empty.
pub const MAX_AWAKE: Duration = Duration::from_secs(30);

type Begin<T> = Box<dyn Fn() -> Option<T> + Send + Sync>;
type End<T> = Arc<dyn Fn(T) + Send + Sync>;

/// A hold on staying awake: taken from any thread, released when the inbox
/// settles, and never longer than its expiry.
pub struct Awake<T: Send + 'static> {
    held: Arc<Mutex<Held<T>>>,
    begin: Begin<T>,
    end: End<T>,
    expiry: Duration,
}

struct Held<T> {
    token: Option<T>,
    /// Which hold a pending expiry belongs to, so a stale one cannot end a
    /// newer hold.
    generation: u64,
}

impl<T: Send + 'static> Awake<T> {
    pub fn new(begin: Begin<T>, end: End<T>, expiry: Duration) -> Self {
        Self {
            held: Arc::new(Mutex::new(Held {
                token: None,
                generation: 0,
            })),
            begin,
            end,
            expiry,
        }
    }

    /// Keep the app awake, unless it already is.
    pub fn hold(&self) {
        let Some(generation) = self.begin_unless_held() else {
            return;
        };
        let held = Arc::clone(&self.held);
        let end = Arc::clone(&self.end);
        let expiry = self.expiry;
        std::thread::spawn(move || {
            std::thread::sleep(expiry);
            expire(&held, &*end, generation);
        });
    }

    /// Let the app sleep again.
    pub fn release(&self) {
        let token = self.held.lock().ok().and_then(|mut held| held.token.take());
        if let Some(token) = token {
            (self.end)(token);
        }
    }

    fn begin_unless_held(&self) -> Option<u64> {
        let mut held = self.held.lock().ok()?;
        if held.token.is_some() {
            return None;
        }
        held.token = Some((self.begin)()?);
        held.generation += 1;
        Some(held.generation)
    }
}

/// End the hold taken as `generation`, unless it was already released or a
/// newer hold has replaced it.
fn expire<T>(held: &Mutex<Held<T>>, end: &(dyn Fn(T) + Send + Sync), generation: u64) {
    let token = held.lock().ok().and_then(|mut held| {
        if held.generation == generation {
            held.token.take()
        } else {
            None
        }
    });
    if let Some(token) = token {
        end(token);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU32, Ordering::SeqCst};
    use std::time::Instant;

    use super::*;

    const NEVER: Duration = Duration::from_secs(3600);

    struct Counts {
        begun: Arc<AtomicU32>,
        ended: Arc<AtomicU32>,
    }

    fn counted(expiry: Duration) -> (Awake<u32>, Counts) {
        let begun = Arc::new(AtomicU32::new(0));
        let ended = Arc::new(AtomicU32::new(0));
        let (on_begin, on_end) = (Arc::clone(&begun), Arc::clone(&ended));
        let awake = Awake::new(
            Box::new(move || Some(on_begin.fetch_add(1, SeqCst))),
            Arc::new(move |_| {
                on_end.fetch_add(1, SeqCst);
            }),
            expiry,
        );
        (awake, Counts { begun, ended })
    }

    fn generation(awake: &Awake<u32>) -> u64 {
        awake.held.lock().expect("held").generation
    }

    #[test]
    fn holding_while_held_begins_nothing_new() {
        let (awake, counts) = counted(NEVER);
        awake.hold();
        awake.hold();
        assert_eq!(counts.begun.load(SeqCst), 1);
    }

    #[test]
    fn a_hold_is_released_once() {
        let (awake, counts) = counted(NEVER);
        awake.hold();
        awake.release();
        awake.release();
        assert_eq!(counts.ended.load(SeqCst), 1);
    }

    #[test]
    fn an_expired_hold_is_not_ended_again_on_release() {
        let (awake, counts) = counted(NEVER);
        awake.hold();
        expire(&awake.held, &*awake.end, generation(&awake));
        awake.release();
        assert_eq!(counts.ended.load(SeqCst), 1);
    }

    #[test]
    fn a_stale_expiry_leaves_a_newer_hold_alone() {
        let (awake, counts) = counted(NEVER);
        awake.hold();
        let first = generation(&awake);
        awake.release();
        awake.hold();

        expire(&awake.held, &*awake.end, first);

        assert_eq!(
            counts.ended.load(SeqCst),
            1,
            "only the release ended anything"
        );
        assert!(
            awake.held.lock().expect("held").token.is_some(),
            "the new hold stands"
        );
    }

    #[test]
    fn a_hold_nobody_releases_ends_by_itself() {
        let (awake, counts) = counted(Duration::from_millis(10));
        awake.hold();
        let deadline = Instant::now() + Duration::from_secs(5);
        while counts.ended.load(SeqCst) == 0 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(counts.ended.load(SeqCst), 1);
    }

    #[test]
    fn when_the_system_grants_nothing_there_is_nothing_to_end() {
        let ended = Arc::new(AtomicU32::new(0));
        let on_end = Arc::clone(&ended);
        let awake: Awake<u32> = Awake::new(
            Box::new(|| None),
            Arc::new(move |_| {
                on_end.fetch_add(1, SeqCst);
            }),
            NEVER,
        );
        awake.hold();
        awake.release();
        assert_eq!(ended.load(SeqCst), 0);
    }
}
