import { hasDeviceProfile, setDeviceProfile } from "@/services/deviceProfile";
import { persistForgeSession, readPersistedSession } from "@/services/authSession";

/** Edge board: skip MeshCentral login when MySQL tunnel is unavailable (npm run board:go). */
export function isBoardLocalAuthEnabled(): boolean {
  const v = import.meta.env.VITE_FORGE_BOARD_LOCAL_AUTH as string | undefined;
  return v === "1" || v === "true";
}

export function boardLocalUsername(): string {
  const u = import.meta.env.VITE_FORGE_BOARD_LOCAL_USER as string | undefined;
  const s = u != null ? String(u).trim().toLowerCase() : "";
  return s || "board@local";
}

function ensureBoardLocalDeviceProfile(username: string): void {
  if (hasDeviceProfile(username)) return;
  setDeviceProfile(username, {
    serialNumber: "BOARD-LOCAL-001",
    deviceName: "Forge Board",
    organizationName: "Local",
    email: `${username.replace(/@.*/, "")}@local`,
    registeredAt: Date.now(),
  });
}

/** Apply one-time local session on the board so / opens the dashboard, not /login. */
export function applyBoardLocalAuthIfEnabled(): {
  isLoggedIn: boolean;
  username: string | null;
  registrationGateOpen: boolean;
} {
  if (!isBoardLocalAuthEnabled()) {
    const p = readPersistedSession();
    const u = p?.username ?? null;
    return {
      isLoggedIn: Boolean(u),
      username: u,
      registrationGateOpen: Boolean(u && hasDeviceProfile(u)),
    };
  }

  const username = boardLocalUsername();
  persistForgeSession(username);
  ensureBoardLocalDeviceProfile(username);
  return {
    isLoggedIn: true,
    username,
    registrationGateOpen: true,
  };
}
