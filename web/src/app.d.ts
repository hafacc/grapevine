// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {}

  interface Window {
    // Chrome's offer to install, held by the script in `src/app.html` until
    // `src/lib/utils/install.svelte.ts` has loaded to take it.
    grapevineInstallPrompt?: Event;
  }

  interface ImportMetaEnv {
    // "1" when the dev server is to talk to a local `supabase start`
    // (`bun run dev:local`); see `src/lib/utils/project.ts`.
    readonly VITE_LOCAL_SUPABASE?: string;
  }
}

export {};
