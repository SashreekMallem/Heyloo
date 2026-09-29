import { redirect } from "next/navigation";

/**
 * SETTINGS-1: `/dashboard/settings` returned 404 (the settings audit), yet
 * it's the first URL an owner guesses. The agent Overview is the settings
 * hub (Settings checklist + every section), so send them there.
 */
export default function SettingsIndexPage(): never {
  redirect("/dashboard/agent");
}
