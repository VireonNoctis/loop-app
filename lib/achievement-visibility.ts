export function canViewAchievementStats(input: {
  viewerId: string | null | null
  targetId: string
  profileActive: boolean
  blocked: boolean
  restricted: boolean
  isApprovedFollower: boolean
}): boolean {
  if (!input.profileActive || input.blocked) return false
  if (input.viewerId !== null && input.viewerId === input.targetId) return true
  if (!input.restricted) return true
  if (input.viewerId === null) return false
  if (input.viewerId === null) return false
  return input.isApprovedFollower
}
