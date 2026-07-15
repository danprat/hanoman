import React from "react";
import type { UserView } from "@hanoman/shared";
import { api } from "../api/client";

type Ctx = { user: UserView | null; logout: () => Promise<void> };

// Nilai default aman: <Shell>/<AccountMenu> yang dirender tanpa provider (mis. test)
// tak error dan AccountMenu memilih tak menampilkan apa-apa (user null).
export const AuthContext = React.createContext<Ctx>({ user: null, logout: async () => {} });
export const useAuth = () => React.useContext(AuthContext);

export function AuthProvider({ user, onLoggedOut, children }:
  { user: UserView; onLoggedOut: () => void; children: React.ReactNode }) {
  // Bersihkan state klien di `finally`: walau panggilan jaringan gagal, pengguna tetap
  // dikembalikan ke Login — konsisten dengan AccountPanel (SettingsScreen).
  const logout = React.useCallback(async () => {
    try { await api.logout(); }
    catch { /* jaringan gagal — abaikan; klien tetap dibersihkan di finally */ }
    finally { onLoggedOut(); }
  }, [onLoggedOut]);
  return <AuthContext.Provider value={{ user, logout }}>{children}</AuthContext.Provider>;
}
