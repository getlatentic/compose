/**
 * The welcome note. It is NOT written to disk when the notes folder is created —
 * the editor's empty view creates it as the user's first note when they click
 * "New note" on a fresh, empty workspace, so an empty folder starts truly empty
 * and a returning user's folder is never touched.
 */
export const WELCOME_NOTE_NAME = "Welcome.md";

export const WELCOME_NOTE_CONTENT = `# Welcome to Compose

This is your notes folder. Every note you write lives right here on your computer as a plain Markdown file — nothing is uploaded.

## A few things to try

- **Just start writing.** Add a new note any time with the **+** button.
- **Ask the assistant.** Open the chat on the right and ask it to draft, edit, or summarize — it works directly in your files.
- **Highlight any text** to comment on it or send it to the assistant.

You can delete this note whenever you like. Happy writing!
`;
