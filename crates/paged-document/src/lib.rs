//! A markdown file read and edited a window at a time.
//!
//! A file is opened without being read. An [`Index`] of places where reading
//! may start is built in the background, and a [`Window`] of text is read
//! from any of them. An edit is held beside the file and costs the same at
//! any size; a save writes the text in the file's place. No more than a
//! window of the file, and the edits, are in memory.

mod document;
mod index;
mod pieces;
#[cfg(test)]
mod random_edits;
mod scan;

pub use document::{PagedDocument, Progress, SaveError, Saved, Window};
pub use index::{Checkpoint, Index};
