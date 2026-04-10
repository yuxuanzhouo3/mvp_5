/**
 * Google Sign-In Bridge for Android WebView
 *
 * Communicates with the native Android GoogleSignInBridge via
 * the JavaScript interface `window.GoogleSignIn`.
 *
 * The Android side exposes three methods:
 *   - signIn(clientId, callbackName)
 *   - signOut(callbackName)
 *   - getCurrentUser(): string | null
 *
 * Adapted from MornGPT (mvp_28) implementation.
 */

interface GoogleSignInResult {
  success: boolean;
  idToken?: string;
  email?: string;
  displayName?: string;
  photoUrl?: string | null;
  error?: string;
}

interface GoogleSignInBridge {
  signIn(clientId: string, callback: string): void;
  signOut(callback: string): void;
  getCurrentUser(): string | null;
}

declare global {
  interface Window {
    GoogleSignIn?: GoogleSignInBridge;
  }
}

/**
 * Returns `true` when the page is loaded inside an Android WebView that has
 * the native Google Sign-In bridge injected.
 */
export function isAndroidWebView(): boolean {
  return typeof window !== "undefined" && !!window.GoogleSignIn;
}

/**
 * Trigger the native Google Sign-In flow.
 *
 * @param clientId  Google OAuth Web Client ID (the *web* client ID is used
 *                  as the `audience` / `requestIdToken` parameter).
 * @returns A promise that resolves with the sign-in result including `idToken`.
 */
export function signInWithGoogle(
  clientId: string,
): Promise<GoogleSignInResult> {
  return new Promise((resolve, reject) => {
    if (!isAndroidWebView()) {
      reject(new Error("Not running in Android WebView"));
      return;
    }

    const callbackName = `googleSignInCallback_${Date.now()}`;
    (window as any)[callbackName] = (result: GoogleSignInResult) => {
      delete (window as any)[callbackName];

      if (result.success) {
        resolve(result);
      } else {
        reject(new Error(result.error || "Sign in failed"));
      }
    };

    try {
      window.GoogleSignIn!.signIn(clientId, callbackName);
    } catch (error) {
      delete (window as any)[callbackName];
      reject(error);
    }
  });
}

/**
 * Sign out from the native Google account cache.
 */
export function signOutGoogle(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isAndroidWebView()) {
      reject(new Error("Not running in Android WebView"));
      return;
    }

    const callbackName = `googleSignOutCallback_${Date.now()}`;
    (window as any)[callbackName] = (result: GoogleSignInResult) => {
      delete (window as any)[callbackName];

      if (result.success) {
        resolve();
      } else {
        reject(new Error(result.error || "Sign out failed"));
      }
    };

    try {
      window.GoogleSignIn!.signOut(callbackName);
    } catch (error) {
      delete (window as any)[callbackName];
      reject(error);
    }
  });
}

/**
 * Retrieve the currently signed-in Google user (if any) without triggering
 * the sign-in flow.
 */
export function getCurrentUser(): GoogleSignInResult | null {
  if (!isAndroidWebView()) {
    return null;
  }

  try {
    const userJson = window.GoogleSignIn!.getCurrentUser();
    if (userJson) {
      return JSON.parse(userJson);
    }
  } catch (error) {
    console.error("Failed to get current user:", error);
  }

  return null;
}
