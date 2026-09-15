export * from "./accordion.js";
export * from "./alert-dialog.js";
export * from "./avatar.js";
export * from "./badge.js";
export * from "./breadcrumb.js";
export * from "./button.js";
export * from "./card.js";
export * from "./checkbox.js";
// `command.js` (cmdk-backed), `input-otp.js` (input-otp-backed), and
// `calendar.js` (react-day-picker-backed, which pulls in `date-fns`) are
// deliberately NOT re-exported from here — import them from
// `@heyloo/ui/command`/`@heyloo/ui/input-otp`/`@heyloo/ui/date-range`
// instead (separate `exports` subpaths, package.json). Same fix as
// `../index.ts`'s `charts` exclusion: each pulls a real 3rd-party
// dependency into ANY consumer of this barrel's module graph, and their
// only real call sites (the admin ⌘K palette, the MFA challenge/enroll
// pages, the tenant dashboard overview's date-range filter) are nowhere
// near the marketing routes that were measuring the cost.
export * from "./dialog.js";
export * from "./form.js";
export * from "./input.js";
export * from "./label.js";
export * from "./nav-item.js";
export * from "./pagination.js";
export * from "./progress.js";
export * from "./select.js";
export * from "./separator.js";
export * from "./sheet.js";
export * from "./sidebar.js";
export * from "./skeleton.js";
export * from "./sonner.js";
export * from "./switch.js";
export * from "./table.js";
export * from "./tabs.js";
export * from "./textarea.js";
export * from "./toggle.js";
export * from "./toggle-group.js";
export * from "./tooltip.js";
// `collapsible.js`, `dropdown-menu.js`, `hover-card.js`,
// `navigation-menu.js`, and `radio-group.js` are deliberately NOT
// re-exported from here — grep-confirmed (SITE REPAIR, 5th pass) to have
// ZERO consumers anywhere in `apps/web` (not merely off the marketing
// routes — genuinely unused today). Import them from
// `@heyloo/ui/primitives-extra` instead, the same barrel-leakage fix as
// `command`/`date-range` above, applied to the ~89KB gz of Radix-backed
// primitives this barrel was shipping to every marketing route
// regardless of use (docs/BUILD_NOTES.md's "4th pass" entry names this
// exact audit as the next lever).
//
// `popover.js` and `scroll-area.js` (their only real consumer,
// `NotificationCenter`, plus `date-range-picker.js`'s already-carved-out
// `Popover` use) and `slider.js` (its only real consumer, `AudioPlayer`)
// are likewise excluded — see `@heyloo/ui/notification` and
// `@heyloo/ui/audio-player` respectively, and `../custom/index.ts`'s
// matching exclusions.
