// Available permission sections that can be assigned to team members
export const AVAILABLE_PERMISSIONS = [
  { key: "moderation", label: "Content Moderation", description: "Review reports, approve/reject content" },
  { key: "gifs_emojis", label: "GIF & Emoji Management", description: "Upload and manage GIFs and custom emojis" },
  { key: "ads", label: "Ad Management", description: "Create and manage advertisements" },
  { key: "events", label: "Event Management", description: "Create and manage events" },
  { key: "support", label: "Support & Tickets", description: "Handle support tickets and appeals" },
  { key: "analytics", label: "Analytics", description: "View app analytics and metrics" },
  { key: "economy", label: "Economy Control", description: "Manage coins, withdrawals, and economy" },
  { key: "pro_lounge", label: "Pro Lounge", description: "Manage premium/pro features" },
  { key: "organizations", label: "Organizations", description: "Manage organization profiles" },
  { key: "featured", label: "Featured Content", description: "Feature/unfeature posts and creators" },
  { key: "broadcast", label: "Broadcast", description: "Send broadcast messages" },
  { key: "verification", label: "Verification", description: "Manage verification badges" },
  { key: "awards", label: "Awards", description: "Manage awards and recognition" },
  { key: "coloop_sessions", label: "Co-Loop Sessions", description: "Manage co-loop sessions" },
  { key: "account_management", label: "Account Management", description: "Delete or manage user accounts" },
  { key: "health", label: "System Health", description: "View system health and status" },
  { key: "cache", label: "Cache Management", description: "Inspect and clear platform caches" },
  { key: "settings", label: "Platform Settings", description: "Manage platform-level settings" },
]

export type PermissionKey = (typeof AVAILABLE_PERMISSIONS)[number]["key"]
