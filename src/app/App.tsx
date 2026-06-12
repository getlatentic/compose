import { AppShell } from "./AppShell";
import { TextPromptProvider } from "../features/dialogs/TextPromptProvider";

export function App() {
  return (
    <TextPromptProvider>
      <AppShell />
    </TextPromptProvider>
  );
}
