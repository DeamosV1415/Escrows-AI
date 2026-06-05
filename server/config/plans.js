// ─── Central plan → storage-limit configuration ───
// Single source of truth so storage enforcement (backend) and the usage bar
// (frontend) stay in sync. Adding a new plan only requires a new entry here.
//
// Limits come from the R2 pricing guide / pricing page:
//   Free 100 MB · Growth 2 GB · Pro 10 GB

export const STORAGE_LIMITS_MB = {
  free: 100,
  growth: 2048, // 2 GB
  pro: 10240, // 10 GB
};

const MB = 1024 * 1024;

/**
 * Resolve a plan name to its storage limit in bytes.
 * Unknown / missing plans fall back to the Free tier, so the backend never
 * breaks before onboarding plan-selection is wired up (every user is "free"
 * by default) and stays safe if an unmapped plan value ever appears.
 */
export function getStorageLimitBytes(plan) {
  const mb = STORAGE_LIMITS_MB[plan] ?? STORAGE_LIMITS_MB.free;
  return mb * MB;
}

export function getStorageLimitMB(plan) {
  return STORAGE_LIMITS_MB[plan] ?? STORAGE_LIMITS_MB.free;
}
