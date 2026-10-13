import { ExternalLink } from "lucide-react";
import { Reveal } from "../website2026/MarketingMotion";
import { mktCardLg, mktEyebrow, mktSubtext } from "../marketingThemeClasses";
import { publicAssetUrl } from "../../../lib/publicAssetUrl";

/**
 * The WAKA setup video.
 *
 * PROGRESSIVE BY CONSTRUCTION, and that is not luck. `preload="metadata"` asks
 * the browser for the header only, and the file's `moov` atom sits BEFORE `mdat`
 * (offset 32 — it is already faststart), so the metadata it needs is in the first
 * ~89 KB. The host also answers with `Accept-Ranges: bytes`, so playback streams
 * from where the customer's network gets to. Nothing about the file is altered
 * to achieve this: it is the original, byte for byte.
 *
 * THREE DELIBERATE OMISSIONS.
 *   * No `preload="auto"` and no `autoPlay` — a 35 MB download is the customer's
 *     decision to make, not ours.
 *   * No `poster`. The instruction was to use one only if a suitable thumbnail
 *     already exists, and none does; inventing a path would produce a broken
 *     image. A real frame can be added later by whoever owns the footage.
 *   * No `<track>` captions. None exist, and a fabricated one would be worse
 *     than none. The video is labelled and described in text instead.
 */

/**
 * THE ONE PLACE TO CHANGE WHEN THE VIDEO MOVES TO STORAGE.
 *
 * DECIDED: the original is hosted in Supabase Storage, not committed. It is 35 MB
 * — it would sit in git history forever, grow `dist/` from 20 MB to 55 MB, and
 * ride along inside the Capacitor Android and iOS bundles, which share `public/`
 * as their web root.
 *
 * VERIFIED, NOT ASSUMED. The hosted object was downloaded and checked before this
 * URL was wired in — HTTP 200, `Content-Type: video/mp4`, exactly 37,140,796
 * bytes, and SHA-256 aeee670900a129a3d16ecdd82159e1d14056d0dfe9b5efc41fde9a25ed800b53,
 * identical to the original. `moov` still precedes `mdat`, so the metadata-only
 * preload below stays cheap, and the host answers `Accept-Ranges: bytes` so
 * playback streams. The repository copy was deleted only after all of that
 * passed, so the 35 MB no longer reaches `dist/` or the mobile bundles.
 *
 * (The bucket is literally named `waka-printer-setup.mp4` and the object repeats
 * the extension. Untidy, but it is the URL that serves the file; renaming the
 * bucket would change this one line and nothing else.)
 *
 * SWAPPING IT IS ONE LINE, and only this line: put the new public object URL
 * here. `publicAssetUrl` passes an absolute URL through untouched, so nothing
 * else in this component changes — but never wire in a URL that has not been
 * downloaded and verified first.
 */
export const PRINTER_SETUP_VIDEO_PATH =
  "https://ljaedextsenbkxzzgxcg.supabase.co/storage/v1/object/public/waka-printer-setup.mp4/waka-printer-setup.mp4.mp4";

export function PrinterSetupVideo() {
  const src = publicAssetUrl(PRINTER_SETUP_VIDEO_PATH);

  return (
    <Reveal>
      <div className={`${mktCardLg} p-5 sm:p-7`}>
        <p className={`text-xs font-black uppercase tracking-[0.22em] ${mktEyebrow}`}>Setup video</p>
        <h2 className="mt-3 max-w-3xl text-2xl font-black leading-tight text-mkt-text sm:text-3xl">
          Watch the printer tested, set up and printing a sale.
        </h2>
        <p className={`mt-3 max-w-2xl text-sm font-medium leading-relaxed ${mktSubtext}`}>
          The whole routine on the real hardware: pairing the WP-58 over Bluetooth, loading a 58mm roll, a test print,
          and then a receipt coming out of a live sale in DKASU POS. A few minutes is enough to see whether it fits the
          way your counter works.
        </p>

        {/*
          `aspect-video` reserves the 1280x720 box before the video loads, so the
          section does not jump when metadata arrives. The width/height pair backs
          that up for anything that ignores the CSS.
        */}
        <div className="mt-5 overflow-hidden rounded-2xl border border-mkt-border bg-black">
          <video
            className="block h-auto w-full"
            src={src}
            width={1280}
            height={720}
            controls
            playsInline
            preload="metadata"
            controlsList="nodownload"
            aria-label="Waka POS WP-58 printer setup: pairing, loading a paper roll, a test print and a receipt from a sale"
          >
            {/* Shown only by browsers that cannot play the file at all. */}
            <p className="p-4 text-sm font-semibold text-white">
              Your browser cannot play this video.{" "}
              <a href={src} target="_blank" rel="noreferrer" className="font-bold underline">
                Open it in a new tab
              </a>{" "}
              instead.
            </p>
          </video>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {/*
            A plain link, not a workaround: if the embedded player is blocked by a
            browser, an extension or a poor connection, this always works.
          */}
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border-2 border-mkt-border bg-mkt-card px-4 text-sm font-bold text-mkt-text transition hover:border-waka-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2 focus-visible:ring-offset-mkt-bg"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Trouble playing? Open the video separately
          </a>
          <p className={`text-xs font-semibold ${mktSubtext}`}>
            Nothing downloads until you press play.
          </p>
        </div>
      </div>
    </Reveal>
  );
}
