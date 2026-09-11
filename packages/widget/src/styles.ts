/**
 * Inline styles injected into the shadow root's own `<style>` tag — never a
 * `<link>` to an external stylesheet (host-page CSS must never leak in,
 * this widget's CSS must never leak out; that isolation is the whole point
 * of shadow DOM here). Hand-authored to loosely track
 * `docs/DESIGN_SYSTEM.md`'s "premium restraint" palette (near-monochrome
 * neutrals + one accent) in plain hex/rgb — this package can't import
 * `packages/ui`'s Tailwind v4 OKLCH tokens (that package is React-only and
 * this widget is framework-free by design), so the palette is a deliberate,
 * small, hand-picked subset rather than a generated one.
 */

const DEFAULT_ACCENT = "#d96a3f"; // warm coral-amber, same hue family as DESIGN_SYSTEM.md's "ember"

export function buildStyles(accent: string | null): string {
  const a = accent && /^#[0-9a-fA-F]{3,8}$/.test(accent) ? accent : DEFAULT_ACCENT;
  return (
    ":host{all:initial}" +
    "*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}" +
    ".hl-launcher{position:fixed;bottom:20px;width:56px;height:56px;border-radius:9999px;border:none;background:" +
    a +
    ";color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.22);cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2147483000;transition:transform .15s ease-out}" +
    ".hl-launcher:hover{transform:scale(1.05)}" +
    ".hl-launcher:focus-visible{outline:2px solid " +
    a +
    ";outline-offset:3px}" +
    ".hl-launcher.hl-right{right:20px}.hl-launcher.hl-left{left:20px}" +
    ".hl-panel{position:fixed;bottom:88px;width:min(360px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 120px));background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.28);display:flex;flex-direction:column;overflow:hidden;z-index:2147483000;border:1px solid #e7e5e4}" +
    ".hl-panel.hl-right{right:20px}.hl-panel.hl-left{left:20px}" +
    ".hl-panel[hidden]{display:none}" +
    ".hl-header{background:" +
    a +
    ";color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between}" +
    ".hl-header h1{font-size:15px;font-weight:600;margin:0}" +
    ".hl-header .hl-sub{font-size:12px;opacity:.85;margin-top:2px}" +
    ".hl-close{background:transparent;border:none;color:#fff;cursor:pointer;font-size:18px;line-height:1;padding:4px;border-radius:6px}" +
    ".hl-close:hover{background:rgba(255,255,255,.15)}" +
    // These two panels are toggled purely via the `hidden` attribute
    // (`panel.ts`'s `showTab`) — deliberately NO inline `style="display:…"`
    // on either element (a past bug here: an inline display style always
    // beats the `[hidden]{display:none}` UA-stylesheet rule below,
    // regardless of the `hidden` attribute/property, so both panels
    // rendered stacked on top of each other at once).
    ".hl-chat-panel{display:flex;flex-direction:column;flex:1;min-height:0}" +
    ".hl-voice-panel{display:flex;flex:1;min-height:0}" +
    "[hidden]{display:none!important}" +
    ".hl-tabs{display:flex;border-bottom:1px solid #e7e5e4}" +
    ".hl-tab{flex:1;padding:10px 8px;background:#fafaf9;border:none;font-size:13px;font-weight:500;color:#57534e;cursor:pointer;border-bottom:2px solid transparent}" +
    ".hl-tab[aria-selected='true']{color:" +
    a +
    ";border-bottom-color:" +
    a +
    ";background:#fff}" +
    ".hl-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#fff;font-size:13px;color:#292524}" +
    ".hl-msg{max-width:85%;padding:8px 11px;border-radius:12px;font-size:13px;line-height:1.4;white-space:pre-wrap;word-break:break-word}" +
    ".hl-msg-customer{align-self:flex-end;background:" +
    a +
    ";color:#fff;border-bottom-right-radius:4px}" +
    ".hl-msg-ai{align-self:flex-start;background:#f5f5f4;color:#292524;border-bottom-left-radius:4px}" +
    ".hl-msg-system{align-self:center;background:transparent;color:#78716c;font-size:12px;text-align:center}" +
    ".hl-form{display:flex;gap:8px;padding:12px;border-top:1px solid #e7e5e4;background:#fff}" +
    ".hl-input{flex:1;border:1px solid #d6d3d1;border-radius:9999px;padding:9px 14px;font-size:13px;outline:none}" +
    ".hl-input:focus{border-color:" +
    a +
    "}" +
    ".hl-send{background:" +
    a +
    ";color:#fff;border:none;border-radius:9999px;width:36px;height:36px;cursor:pointer;flex-shrink:0}" +
    ".hl-send:disabled{opacity:.5;cursor:default}" +
    ".hl-voice{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center}" +
    ".hl-voice-orb{width:84px;height:84px;border-radius:9999px;background:" +
    a +
    ";display:flex;align-items:center;justify-content:center;color:#fff}" +
    ".hl-voice-orb.hl-live{animation:hl-pulse 1.6s ease-out infinite}" +
    "@keyframes hl-pulse{0%{box-shadow:0 0 0 0 rgba(0,0,0,.18)}100%{box-shadow:0 0 0 18px rgba(0,0,0,0)}}" +
    ".hl-voice-status{font-size:13px;color:#57534e}" +
    ".hl-btn{border:none;border-radius:9999px;padding:10px 22px;font-size:13px;font-weight:600;cursor:pointer}" +
    ".hl-btn-primary{background:" +
    a +
    ";color:#fff}" +
    ".hl-btn-danger{background:#dc2626;color:#fff}" +
    ".hl-btn:disabled{opacity:.5;cursor:default}" +
    ".hl-footer{padding:8px 14px;font-size:11px;color:#a8a29e;text-align:center;border-top:1px solid #f5f5f4}" +
    "@media (prefers-reduced-motion: reduce){.hl-voice-orb.hl-live{animation:none}.hl-launcher{transition:none}}" +
    "@media (max-width:480px){.hl-panel{width:calc(100vw - 24px);right:12px !important;left:12px !important;bottom:80px}}"
  );
}
