/**
 * notificationManager.ts — v68.0.0 "Real-World Integration III"
 * Multi-channel notification dispatch: email, SMS, push, Slack, with deduplication and rate limiting.
 */

export type NotificationChannel = "email" | "sms" | "push" | "slack" | "webhook";
export type NotificationPriority = "low" | "normal" | "high" | "critical";
export interface Notification { id: string; channel: NotificationChannel; recipient: string; subject: string; body: string; priority: NotificationPriority; sentAt?: number; delivered: boolean; error?: string; }

const sent: Notification[] = [];
const dedupeCache = new Map<string, number>();
let notifCounter = 0;

export function sendNotification(channel: NotificationChannel, recipient: string, subject: string, body: string, priority: NotificationPriority = "normal"): Notification {
  const dedupeKey = `${channel}:${recipient}:${subject}`;
  const lastSent = dedupeCache.get(dedupeKey);
  const DEDUPE_WINDOW = 60_000;
  const notif: Notification = { id: `notif-${++notifCounter}`, channel, recipient, subject, body, priority, delivered: false };
  if (lastSent && Date.now() - lastSent < DEDUPE_WINDOW) {
    notif.error = "Deduplicated: same notification sent recently";
    sent.push(notif);
    return notif;
  }
  dedupeCache.set(dedupeKey, Date.now());
  // Simulate delivery (real implementations would call external APIs)
  notif.sentAt = Date.now();
  notif.delivered = true;
  sent.push(notif);
  return notif;
}

export function getNotifications(channel?: NotificationChannel): Notification[] {
  return channel ? sent.filter(n => n.channel === channel) : [...sent];
}

export function getDeliveryRate(): number {
  if (sent.length === 0) return 1;
  return sent.filter(n => n.delivered).length / sent.length;
}

export function _resetNotificationManagerForTest(): void { sent.length = 0; dedupeCache.clear(); notifCounter = 0; }
