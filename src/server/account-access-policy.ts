export function canSuspendAdminWithoutOrphaningAccess(
  activeAdminCount: number,
) {
  return activeAdminCount > 1;
}
