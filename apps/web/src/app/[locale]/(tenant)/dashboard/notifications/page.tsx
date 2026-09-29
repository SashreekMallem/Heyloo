import { redirect } from "next/navigation";

/**
 * SETTINGS-1: `/dashboard/notifications` returned 404 (the settings audit).
 * Owner alert recipients live on the Delivery page ("Your alerts").
 */
export default function NotificationsIndexPage(): never {
  redirect("/dashboard/delivery");
}
