import { invoke } from "@tauri-apps/api/core";

/**
 * The image behind the note. The chosen file is copied into Compose's own
 * data folder, and only that folder is opened to the web view.
 */

/** Keep the image at `source` as the background; returns where it is kept. */
export async function storeBackgroundImage(source: string): Promise<string> {
  return invoke<string>("background_image_store", { source });
}

/** Open the kept background's folder to the web view again, as after a launch. */
export async function allowBackgroundImage(): Promise<void> {
  await invoke("background_image_allow");
}
