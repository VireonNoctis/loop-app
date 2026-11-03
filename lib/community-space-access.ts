export type CommunitySpaceVisibility = "public" | "members" | "mods"

/** Space visibility is independent from the parent Circle's visibility. */
export function canViewCommunitySpace(
  visibility: unknown,
  isMember: boolean,
  isModerator: boolean,
): boolean {
  if (visibility === "public") return true
  if (visibility === "members") return isMember
  if (visibility === "mods") return isModerator
  return false
}
