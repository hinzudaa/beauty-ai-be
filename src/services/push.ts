import webpush from "web-push";
import { config } from "../config";
import { PushSubscription } from "../models/pushSubscription";

webpush.setVapidDetails(
  config.vapid.email,
  config.vapid.publicKey,
  config.vapid.privateKey
);

export interface PushPayload {
  title:   string;
  body:    string;
  icon?:   string;
  url?:    string;
  badge?:  string;
}

/** Send push notification to ALL admin subscribers */
export async function sendAdminPush(payload: PushPayload): Promise<void> {
  const subscriptions = await PushSubscription.find().lean();
  if (!subscriptions.length) return;

  const data = JSON.stringify(payload);

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
          data
        );
      } catch (err: unknown) {
        // Remove expired/invalid subscriptions (410 Gone)
        if (err && typeof err === "object" && "statusCode" in err &&
            (err as { statusCode: number }).statusCode === 410) {
          await PushSubscription.deleteOne({ endpoint: sub.endpoint });
        }
      }
    })
  );
}
