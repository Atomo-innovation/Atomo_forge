/**
 * Login flag for Forge routing. Intentionally NOT persisted in localStorage or
 * sessionStorage — every fresh page load (Ctrl-R, new tab, app restart) must
 * authenticate against the database again through /api/auth/login. The flag
 * only lives in memory for the lifetime of the current React app instance so
 * that internal navigations between /dashboard / /register / etc. don't bounce
 * the user back to /login mid-session.
 */
const KEY = "atomo_logged_in";

export function readLoggedIn(): boolean {
  // One-time cleanup: older builds persisted this. Clear both so an old
  // browser doesn't keep skipping the login screen on a fresh load.
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  return false;
}

export function setLoggedIn(_value: boolean): void {
  // No persistence on purpose. App state (useState in App.tsx) holds the flag
  // until the page is reloaded, then login is required again.
  void _value;
}
