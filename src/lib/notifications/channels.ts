export type ChannelPreference = {
  in_app: boolean;
  email: boolean;
  whatsapp: boolean;
};

const KNOWN = ["in_app", "email", "whatsapp"] as const;

export function allowedChannels(
  requested: string[],
  preferences: Array<ChannelPreference | null>,
) {
  if (preferences.length === 0) return requested;
  return requested.filter((channel) =>
    preferences.every((preference) => {
      if (!preference) return true;
      if (channel === "in_app") return preference.in_app;
      if (channel === "email") return preference.email;
      if (channel === "whatsapp") return preference.whatsapp;
      return true;
    }),
  );
}

export function isKnownChannel(channel: string): channel is (typeof KNOWN)[number] {
  return (KNOWN as readonly string[]).includes(channel);
}
