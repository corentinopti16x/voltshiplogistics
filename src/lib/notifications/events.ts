export const NOTIFICATION_EVENTS = [
  "quote_ready",
  "quote_accepted",
  "quote_question",
  "research_ready",
  "research_failed",
  "lifecycle_changed",
  "restock_requested",
  "ops_request",
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export function isNotificationEvent(value: string): value is NotificationEvent {
  return (NOTIFICATION_EVENTS as readonly string[]).includes(value);
}
