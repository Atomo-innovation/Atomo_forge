import { createContext, useContext } from "react";

/** Normalized MeshCentral username for the current in-app session (memory only). */
const AuthUsernameContext = createContext<string | null>(null);

export function AuthUsernameProvider({
  username,
  children,
}: {
  username: string | null;
  children: React.ReactNode;
}) {
  return <AuthUsernameContext.Provider value={username}>{children}</AuthUsernameContext.Provider>;
}

export function useAuthUsername(): string | null {
  return useContext(AuthUsernameContext);
}
