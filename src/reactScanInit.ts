// react-scan re-render overlay initializer.
//
// This module is imported ONLY when the app is built with
// `COMPOSE_REACT_SCAN=1` — a Vite plugin (vite.config.ts) prepends an
// `import "./reactScanInit"` to the top of `main.tsx` in that case. It is
// never referenced in a normal build, so it (and react-scan) tree-shake
// to zero bytes.
//
// It exists as a separate side-effect module, imported FIRST, because
// react-scan must install its reconciler hook before React evaluates.
// A dynamic import inside main.tsx can't achieve that (ESM hoists the
// React imports). `dangerouslyForceRunInProduction` is required because
// `pnpm tauri build` is a production build and react-scan self-disables
// in production otherwise — safe here since this module only ships in an
// explicitly opted-in perf build.
import { scan } from "react-scan";

scan({
  enabled: true,
  dangerouslyForceRunInProduction: true,
  showToolbar: true,
  showFPS: true,
});
