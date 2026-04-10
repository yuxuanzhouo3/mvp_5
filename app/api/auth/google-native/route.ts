import { NextRequest, NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { syncGlobalAuthUser } from "@/lib/server/supabase-auth-user-sync";
import { trackLoginEvent, trackRegisterEvent } from "@/services/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/google-native
 *
 * Accepts a Google `idToken` obtained from the Android native Sign-In SDK,
 * verifies it, and creates / logs-in the corresponding Supabase user.
 *
 * Adapted from MornGPT (mvp_28) but uses MornFake's `app_users` +
 * `user_auth_identities` schema via `syncGlobalAuthUser`.
 */
export async function POST(request: NextRequest) {
  try {
    const { idToken, displayName } = await request.json();

    if (!idToken) {
      return NextResponse.json({ error: "Missing idToken" }, { status: 400 });
    }

    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      return NextResponse.json(
        { error: "Google Client ID not configured" },
        { status: 500 },
      );
    }

    // ---- 1. Verify Google idToken ----
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({
      idToken,
      audience: clientId,
    });

    const payload = ticket.getPayload();
    if (!payload?.email) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: "Supabase Admin client not configured" },
        { status: 500 },
      );
    }

    // ---- 2. Find or create the auth.users entry ----
    let authUserId: string;

    // Check if user already exists in auth.users by email
    const {
      data: { users: existingUsers },
      error: listError,
    } = await supabaseAdmin.auth.admin.listUsers();

    if (listError) {
      console.error("[google-native] Failed to list users:", listError.message);
      return NextResponse.json(
        { error: "Failed to look up user" },
        { status: 500 },
      );
    }

    const existingUser = existingUsers?.find(
      (u) => u.email?.toLowerCase() === payload.email!.toLowerCase(),
    );

    let isNewUser = false;

    if (existingUser) {
      authUserId = existingUser.id;
    } else {
      // Create a new auth user
      const { data: newAuthData, error: createError } =
        await supabaseAdmin.auth.admin.createUser({
          email: payload.email,
          email_confirm: true,
          user_metadata: {
            full_name: displayName || payload.name,
            avatar_url: payload.picture,
            provider: "google",
          },
        });

      if (createError) {
        // Double-check: the user may have been created between our list check and now
        if (
          createError.message.includes("already been registered") ||
          createError.message.includes("email_exists")
        ) {
          const {
            data: { users: retryUsers },
          } = await supabaseAdmin.auth.admin.listUsers();
          const retryUser = retryUsers?.find(
            (u) => u.email?.toLowerCase() === payload.email!.toLowerCase(),
          );

          if (!retryUser) {
            return NextResponse.json(
              { error: "User exists but could not be found" },
              { status: 500 },
            );
          }

          authUserId = retryUser.id;
        } else {
          console.error(
            "[google-native] Failed to create auth user:",
            createError,
          );
          return NextResponse.json(
            { error: `Failed to create user: ${createError.message}` },
            { status: 500 },
          );
        }
      } else if (newAuthData?.user) {
        authUserId = newAuthData.user.id;
        isNewUser = true;
        console.log("[google-native] Auth user created:", authUserId);
      } else {
        return NextResponse.json(
          { error: "Failed to create user: No data returned" },
          { status: 500 },
        );
      }
    }

    // ---- 3. Sync to app_users + user_auth_identities ----
    // Fetch the full auth user object so we can pass it to syncGlobalAuthUser
    const { data: fetchedUserData, error: fetchError } =
      await supabaseAdmin.auth.admin.getUserById(authUserId);

    if (fetchError || !fetchedUserData?.user) {
      console.error("[google-native] Failed to fetch user:", fetchError);
      return NextResponse.json(
        { error: "Failed to fetch user data" },
        { status: 500 },
      );
    }

    const authUser = fetchedUserData.user;

    // Update user_metadata if needed (e.g. the user was created via email signup before)
    if (
      !authUser.user_metadata?.avatar_url &&
      payload.picture
    ) {
      await supabaseAdmin.auth.admin.updateUserById(authUserId, {
        user_metadata: {
          ...authUser.user_metadata,
          full_name:
            authUser.user_metadata?.full_name ||
            displayName ||
            payload.name,
          avatar_url: payload.picture,
          provider: "google",
        },
      });
    }

    try {
      await syncGlobalAuthUser(authUser, {
        markVerified: true,
        touchLastLoginAt: true,
      });
    } catch (syncError) {
      console.warn("[google-native] syncGlobalAuthUser failed:", syncError);
      // Non-fatal: continue to return the session
    }

    // ---- 4. Generate a Supabase-compatible session ----
    // Use Supabase Admin to generate a link that we can exchange for a session
    // Alternatively, issue a custom JWT like MornGPT does
    const jwt = require("jsonwebtoken");
    const JWT_SECRET =
      process.env.SUPABASE_JWT_SECRET ||
      process.env.JWT_SECRET ||
      "default-secret-key-change-in-production";

    const accessToken = jwt.sign(
      {
        sub: authUserId,
        email: payload.email,
        role: "authenticated",
        aud: "authenticated",
      },
      JWT_SECRET,
      { expiresIn: "1h" },
    );

    const refreshToken = jwt.sign(
      {
        sub: authUserId,
        email: payload.email,
      },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    // ---- 5. Track analytics ----
    const trackFn = isNewUser ? trackRegisterEvent : trackLoginEvent;
    trackFn(authUserId, {
      userAgent:
        request.headers.get("user-agent") || undefined,
      ...(isNewUser ? { registerMethod: "google_native" } : {}),
    }).catch((err) =>
      console.warn("[google-native] track event error:", err),
    );

    // ---- 6. Read back the app_users row for the response ----
    const { data: appUser } = await supabaseAdmin
      .from("app_users")
      .select("id, email, display_name, avatar_url")
      .eq("id", authUserId)
      .eq("source", "global")
      .single();

    const session = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600,
      refresh_token_expires_in: 604800,
      token_type: "bearer",
      user: {
        id: authUserId,
        email: payload.email,
        role: "authenticated",
      },
    };

    return NextResponse.json({
      success: true,
      user: {
        id: authUserId,
        email: payload.email,
        name:
          appUser?.display_name ||
          displayName ||
          payload.name ||
          payload.email.split("@")[0],
        avatar: appUser?.avatar_url || payload.picture || null,
      },
      session,
    });
  } catch (error) {
    console.error("[google-native] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Authentication failed",
      },
      { status: 500 },
    );
  }
}
