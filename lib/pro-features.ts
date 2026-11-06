/**
 * Loop Pro — launch pricing + feature catalog.
 *
 * This file is the single source of truth for every Pro-only perk shown to
 * users (rendered on the Get Pro page and Pro settings). `enforced` +
 * `enforcedAt` document, for engineering, where each perk is actually gated
 * server/client-side today — keep both in sync whenever a perk's
 * implementation changes so this list never drifts from reality.
 */

export const PRO_PRICING = {
  monthly: {
    id: "monthly" as const,
    name: "Monthly",
    priceUsd: 3.99,
    priceLabel: "$3.99",
    period: "/month",
    coins: 5000,
    days: 30,
    description: "Renews monthly. Cancel any time from billing settings.",
  },
  annual: {
    id: "annual" as const,
    name: "Annual",
    priceUsd: 29.99,
    priceLabel: "$29.99",
    period: "/year",
    coins: 60000,
    days: 365,
    description: "Renews yearly. Cancel any time from billing settings.",
    popular: true,
    savings: "Save ~37%",
  },
} as const

export type ProPlanId = keyof typeof PRO_PRICING

export const PRO_FEATURES = [
  {
    id: "extended_posts",
    title: "Extended Post Length",
    description: "Write longer loops without hitting the free word cap",
    free: "Up to 500 words",
    pro: "Up to 1,800 words",
    icon: "type",
    enforced: true,
  },
  {
    id: "multi_upload",
    title: "Multi-Video & Image Carousel",
    description: "Post up to 10 HD images and video clips in a single loop",
    free: "1 file",
    pro: "Up to 10 videos/images",
    icon: "upload",
    enforced: true,
  },
  {
    id: "xp_boost",
    title: "3× XP & Coin Multiplier",
    description: "Level up 3x faster on posts, likes, gifts, and Co-Loops",
    free: "1× Standard XP",
    pro: "3× Multiplier",
    icon: "zap",
    enforced: false,
  },
  {
    id: "daily_bonus",
    title: "Bigger Daily Coin Claim",
    description: "Claim extra Loop Coins every day you log in",
    free: "+40 coins",
    pro: "Bigger daily claim",
    icon: "coins",
    enforced: true,
  },
  {
    id: "profile_decorations",
    title: "Profile Decorations & Avatar Frames",
    description: "Equip animated avatar frames, auras, and badges from the cosmetics catalog",
    free: "Default avatar",
    pro: "Frames, auras & badges",
    icon: "sparkles",
    enforced: true,
  },
  {
    id: "post_card_effects",
    title: "Post Card Effects",
    description: "Give your loop cards a glow, border, or animated accent from the cosmetics catalog",
    free: "Standard card",
    pro: "Custom card effects",
    icon: "sparkles",
    enforced: true,
  },
  {
    id: "custom_font_theme",
    title: "Custom Display Name Font & Theme",
    description: "Style your display name with a custom font and color theme from the cosmetics catalog",
    free: "Default font",
    pro: "Custom fonts & themes",
    icon: "type",
    enforced: true,
  },
  {
    id: "custom_profile_css",
    title: "Custom Profile CSS",
    description: "Write your own profile styles with a scoped CSS editor and live profile rendering",
    free: "Standard profile styling",
    pro: "Custom profile CSS",
    icon: "code",
    enforced: true,
  },
  {
    id: "gif_avatar",
    title: "Animated GIF Avatar & Banner",
    description: "Stand out with dynamic animated profile pictures & covers",
    free: "Static images",
    pro: "Animated GIFs",
    icon: "sparkles",
    enforced: false,
  },
  {
    id: "co_loop_pro",
    title: "Co-Loop Unlimited Snapshots",
    description: "Store unlimited version history snapshots in Co-Loop Studio",
    free: "3 snapshots",
    pro: "Unlimited history",
    icon: "crown",
    enforced: false,
  },
  {
    id: "pro_badge",
    title: "Gold Pro Crown Badge",
    description: "Exclusive gold crown badge beside your username everywhere",
    free: "Standard badge",
    pro: "Gold Pro Crown",
    icon: "crown",
    enforced: true,
  },
  {
    id: "pin_to_profile",
    title: "Pin Loops to Your Profile",
    description: "Pin your best loops to the top of your profile from the post's \"...\" menu",
    free: "No pinning",
    pro: "Pin up to 3 loops",
    icon: "pin",
    enforced: true,
  },
  {
    id: "stream",
    title: "Instant 4K Live Streaming",
    description: "Host 4K livestreams without waiting for moderator approval",
    free: "Approval required",
    pro: "Instant 4K Live",
    icon: "video",
    enforced: false,
  },
  {
    id: "pro_lounge_access",
    title: "Secret Pro Lounge",
    description: "Exclusive access to the Pro Lounge — founder Q&As, priority feature voting, and a private space for Pro members and the dev team",
    free: "No access",
    pro: "Full Lounge Access",
    icon: "lock",
    enforced: true,
  },
  {
    id: "discord_invite",
    title: "Private Discord Access",
    description: "Join the invite-only Loop Pro Discord server to chat directly with the dev team and other Pro members",
    free: "No access",
    pro: "Discord Invite Access",
    icon: "discord",
    enforced: true,
  },
  {
    id: "express_cashout",
    title: "0% Cashout Fee & 24h Express Payouts",
    description: "Withdraw Loop Coin earnings to your bank with zero platform commission and 24-hour express processing",
    free: "10% fee & standard queue",
    pro: "0% Fee & 24h Express Cashout",
    icon: "dollar",
    enforced: false,
  },
  {
    id: "secret_shop",
    title: "Secret Pro Shop & Free Monthly Drops",
    description: "Access rare stickers, exclusive animated avatar frames, and 1 free legendary cosmetic drop every month",
    free: "Standard shop items",
    pro: "Secret Shop + Free Drops",
    icon: "gift",
    enforced: false,
  },
  {
    id: "communities",
    title: "More Communities",
    description: "Create and run more Circles for your audiences",
    free: "Up to 2 communities",
    pro: "Up to 15 communities",
    icon: "users",
    enforced: true,
  },
] as const

export const CODE_LANGUAGES = [
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "python", label: "Python" },
  { id: "tsx", label: "React / TSX" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "sql", label: "SQL" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "java", label: "Java" },
  { id: "kotlin", label: "Kotlin" },
  { id: "swift", label: "Swift" },
  { id: "php", label: "PHP" },
  { id: "ruby", label: "Ruby" },
  { id: "shell", label: "Shell" },
  { id: "json", label: "JSON" },
  { id: "markdown", label: "Markdown" },
  { id: "other", label: "Other" },
] as const

export interface ProStatus {
  isPro: boolean
  expiresAt: string | null
}

/**
 * A user counts as Pro while `is_premium` is true AND the expiry (when set)
 * is still in the future. This is the single check used for Pro-gated
 * features (Pro-only circle membership, GIF avatars/covers, etc.) so the
 * definition never drifts between routes.
 */
export function isProUser(profile: {
  is_premium?: boolean | null
  premium_expires_at?: string | null
}): boolean {
  if (!profile?.is_premium) return false
  if (!profile.premium_expires_at) return true
  return new Date(profile.premium_expires_at).getTime() > Date.now()
}

export function isCodeLoop(loop: {
  content_type?: string
  media_type?: string
  category?: string
  content_metadata?: any
}) {
  const meta = loop.content_metadata || {}
  return (
    loop.content_type === "code" ||
    loop.media_type === "code" ||
    loop.category === "code" ||
    Boolean(meta.is_code)
  )
}
