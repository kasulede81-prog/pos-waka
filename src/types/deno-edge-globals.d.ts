/**
 * The shared Supabase Edge email modules live in `supabase/functions/_shared/email/` and run on
 * Deno, where `Deno.env` supplies configuration. They are outside this project's `include`
 * ("src"), so they only enter the program when an app-side test imports one — at which point
 * TypeScript has to be told what `Deno` is.
 *
 * Deliberately narrow: only the surface those modules actually use. Nothing under `src/` runs on
 * Deno, so this exists solely so the shared email templates can be type-checked and exercised by
 * unit tests from the app, rather than being asserted on as raw text.
 */
declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};
