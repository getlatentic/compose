//! A markdown file read a window at a time.
//!
//! A file is opened without being read. An [`Index`] of places where reading
//! may start is built in the background, and a [`Window`] of text is read
//! from any of them. No more than a window of the file is in memory, so a
//! file of any size opens at once and moves through at the same speed.

mod document;
mod index;
mod scan;

pub use document::{PagedDocument, Progress, Window};
pub use index::{Checkpoint, Index};
