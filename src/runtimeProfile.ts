export type FrontendVariant = "legacy" | "next";
export type DataProfile = "main" | "next" | "stability";

export function resolveRuntimeProfile(
  frontend: FrontendVariant,
  requestedProfile?: string,
  stability = false,
): DataProfile {
  if (stability) return "stability";
  if (requestedProfile === "main" || requestedProfile === "next")
    return requestedProfile;
  return frontend === "next" ? "next" : "main";
}

export const FRONTEND_VARIANT: FrontendVariant = __LECTIO_FRONTEND__;
export const DATA_PROFILE = resolveRuntimeProfile(
  FRONTEND_VARIANT,
  __LECTIO_DATA_PROFILE__,
  import.meta.env.VITE_STABILITY_TEST === "true",
);

export const STATE_STORAGE_KEY =
  DATA_PROFILE === "main" || DATA_PROFILE === "stability"
    ? "lectio-state-v1"
    : `lectio-state-v1:${DATA_PROFILE}`;

export const ASSET_DATABASE_NAME =
  DATA_PROFILE === "main" ? "lectio-assets" : `lectio-assets-${DATA_PROFILE}`;
