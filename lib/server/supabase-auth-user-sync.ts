import "server-only";

import type { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";

function normalizeText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeEmail(value: unknown) {
  const email = normalizeText(value);
  return email ? email.toLowerCase() : null;
}

function resolveProvider(user: User) {
  const provider = normalizeText(user.app_metadata?.provider)?.toLowerCase();
  return provider === "google" ? "google" : "supabase_email";
}

function resolveDisplayName(user: User, email: string | null) {
  const userMetadata =
    user.user_metadata && typeof user.user_metadata === "object"
      ? (user.user_metadata as Record<string, unknown>)
      : {};

  const candidates = [
    userMetadata.full_name,
    userMetadata.display_name,
    userMetadata.name,
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean);

  if (candidates.length > 0) {
    return candidates[0];
  }

  return email ? email.split("@")[0] || "user" : "user";
}

function resolveAvatarUrl(user: User) {
  const userMetadata =
    user.user_metadata && typeof user.user_metadata === "object"
      ? (user.user_metadata as Record<string, unknown>)
      : {};

  return (
    normalizeText(userMetadata.avatar_url) ||
    normalizeText(userMetadata.picture) ||
    null
  );
}

export async function syncGlobalAuthUser(
  user: User | null | undefined,
  options?: {
    markVerified?: boolean;
    touchLastLoginAt?: boolean;
  },
) {
  if (!supabaseAdmin || !user?.id) {
    return false;
  }

  const nowIso = new Date().toISOString();
  const email = normalizeText(user.email);
  const emailNormalized = normalizeEmail(user.email);
  const provider = resolveProvider(user);
  const displayName = resolveDisplayName(user, emailNormalized);
  const avatarUrl = resolveAvatarUrl(user);
  const verifiedAt =
    normalizeText(user.email_confirmed_at) ||
    (options?.markVerified ? nowIso : null);

  if (emailNormalized) {
    const { error: releaseError } = await supabaseAdmin
      .from("app_users")
      .update({
        email: null,
        email_normalized: null,
        is_active: false,
        updated_at: nowIso,
      })
      .eq("source", "global")
      .eq("email_normalized", emailNormalized)
      .neq("id", user.id);

    if (releaseError) {
      throw releaseError;
    }
  }

  const appUserPayload: Record<string, unknown> = {
    id: user.id,
    source: "global",
    email,
    email_normalized: emailNormalized,
    display_name: displayName,
    avatar_url: avatarUrl,
    is_active: true,
    updated_at: nowIso,
  };

  if (options?.touchLastLoginAt) {
    appUserPayload.last_login_at = nowIso;
  }

  const { error: appUserError } = await supabaseAdmin
    .from("app_users")
    .upsert(appUserPayload, { onConflict: "id" });

  if (appUserError) {
    throw appUserError;
  }

  const identityId =
    provider === "google" ? `iden_google_${user.id}` : `iden_email_${user.id}`;
  const identityPayload: Record<string, unknown> = {
    id: identityId,
    user_id: user.id,
    source: "global",
    provider,
    provider_user_id: user.id,
    provider_email: email,
    is_primary: true,
    metadata_json: {
      app_metadata: user.app_metadata || {},
      user_metadata: user.user_metadata || {},
      synced_from: "app_runtime",
    },
  };

  if (verifiedAt) {
    identityPayload.verified_at = verifiedAt;
  }

  if (options?.touchLastLoginAt) {
    identityPayload.last_login_at = nowIso;
  }

  const { error: identityError } = await supabaseAdmin
    .from("user_auth_identities")
    .upsert(identityPayload, {
      onConflict: "source,provider,provider_user_id",
    });

  if (identityError) {
    throw identityError;
  }

  return true;
}
