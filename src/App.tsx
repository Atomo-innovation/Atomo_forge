import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { useState } from "react";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import Register from "./pages/Register";
import OnboardingSuccess from "./pages/OnboardingSuccess";
import {
  persistForgeSession,
  clearForgeSession,
  readPersistedSession,
} from "@/services/authSession";
import { hasDeviceProfile } from "@/services/deviceProfile";
import { hydrateDeviceProfileFromServer } from "@/services/deviceRegistrations";
import { AuthUsernameProvider } from "@/contexts/AuthUsernameContext";

const queryClient = new QueryClient();

/**
 * Routed content lives inside `BrowserRouter` so logout can navigate to `/login`,
 * while `/dashboard` stays a direct destination with no gate.
 */
const ForgeRoutes = () => {
  const navigate = useNavigate();
  const [isLoggedIn, setIsLoggedIn] = useState(() => readPersistedSession() != null);
  const [loggedInUsername, setLoggedInUsername] = useState<string | null>(() => readPersistedSession()?.username ?? null);
  const [registrationGateOpen, setRegistrationGateOpen] = useState(() => {
    const p = readPersistedSession();
    return Boolean(p != null && hasDeviceProfile(p.username ?? undefined));
  });

  const handleLoginSuccess = async (username: string) => {
    const u = username.trim().toLowerCase();
    persistForgeSession(u);
    setLoggedInUsername(u);
    setIsLoggedIn(true);
    if (!hasDeviceProfile(u)) {
      await hydrateDeviceProfileFromServer(u);
    }
    setRegistrationGateOpen(hasDeviceProfile(u));
  };

  const handleOnboardingComplete = (completedMeshUsername?: string | null) => {
    const u =
      completedMeshUsername != null && String(completedMeshUsername).trim() !== ""
        ? String(completedMeshUsername).trim().toLowerCase()
        : null;
    persistForgeSession(u);
    setLoggedInUsername(u);
    setIsLoggedIn(true);
    setRegistrationGateOpen(hasDeviceProfile(u));
  };

  const handleRegistrationComplete = () => {
    setRegistrationGateOpen(true);
  };

  const handleLogout = () => {
    clearForgeSession();
    setLoggedInUsername(null);
    setIsLoggedIn(false);
    setRegistrationGateOpen(false);
    navigate("/login", { replace: true });
  };

  const postLoginPath = () => (registrationGateOpen ? "/dashboard" : "/register");

  return (
    <AuthUsernameProvider username={loggedInUsername}>
      <Routes>
        <Route
          path="/"
          element={isLoggedIn ? <Navigate to={postLoginPath()} replace /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/login"
          element={isLoggedIn ? <Navigate to={postLoginPath()} replace /> : <Login onLoginSuccess={handleLoginSuccess} />}
        />
        <Route
          path="/register"
          element={
            isLoggedIn ? (
              registrationGateOpen ? (
                <Navigate to="/dashboard" replace />
              ) : (
                <Register onRegistered={handleRegistrationComplete} />
              )
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/success"
          element={isLoggedIn ? <OnboardingSuccess onComplete={handleOnboardingComplete} /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/onboarding"
          element={
            isLoggedIn ? <Navigate to={postLoginPath()} replace /> : <Onboarding onOnboardingComplete={handleOnboardingComplete} />
          }
        />
        <Route path="/dashboard" element={<Dashboard onLogout={handleLogout} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthUsernameProvider>
  );
};

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <ForgeRoutes />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
