import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState } from "react";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import Register from "./pages/Register";
import OnboardingSuccess from "./pages/OnboardingSuccess";
import { readLoggedIn, setLoggedIn } from "@/services/authSession";
import { hasDeviceProfile } from "@/services/deviceProfile";
import { AuthUsernameProvider } from "@/contexts/AuthUsernameContext";

const queryClient = new QueryClient();

const App = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(() => readLoggedIn());
  const [loggedInUsername, setLoggedInUsername] = useState<string | null>(null);
  // True when device registration exists for the current user (or legacy onboarding profile).
  const [registrationGateOpen, setRegistrationGateOpen] = useState(false);

  const handleLoginSuccess = (username: string) => {
    const u = username.trim().toLowerCase();
    setLoggedInUsername(u);
    setLoggedIn(true);
    setIsLoggedIn(true);
    setRegistrationGateOpen(hasDeviceProfile(u));
  };

  const handleOnboardingComplete = (completedMeshUsername?: string | null) => {
    setLoggedIn(true);
    setIsLoggedIn(true);
    const u =
      completedMeshUsername != null && String(completedMeshUsername).trim() !== ""
        ? String(completedMeshUsername).trim().toLowerCase()
        : null;
    if (u) {
      setLoggedInUsername(u);
    }
    setRegistrationGateOpen(hasDeviceProfile(u));
  };

  const handleRegistrationComplete = () => {
    setRegistrationGateOpen(true);
  };

  const handleLogout = () => {
    setLoggedInUsername(null);
    setLoggedIn(false);
    setIsLoggedIn(false);
  };

  // Canonical post-login destination: /register only until device registration
  // has succeeded at least once (cached profile or completed this session).
  const postLoginPath = () => (registrationGateOpen ? "/dashboard" : "/register");

  return (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthUsernameProvider username={loggedInUsername}>
        <Routes>
          <Route
            path="/"
            element={
              isLoggedIn ? <Navigate to={postLoginPath()} replace /> : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/login"
            element={
              isLoggedIn ? <Navigate to={postLoginPath()} replace /> : <Login onLoginSuccess={handleLoginSuccess} />
            }
          />
          <Route
            path="/register"
            element={
              isLoggedIn ? <Register onRegistered={handleRegistrationComplete} /> : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/success"
            element={
              isLoggedIn ? <OnboardingSuccess onComplete={handleOnboardingComplete} /> : <Navigate to="/login" replace />
            }
          />
          <Route
            path="/onboarding"
            element={
              isLoggedIn ? <Navigate to={postLoginPath()} replace /> : <Onboarding onOnboardingComplete={handleOnboardingComplete} />
            }
          />
          <Route
            path="/dashboard"
            element={
              isLoggedIn
                ? (registrationGateOpen ? <Dashboard onLogout={handleLogout} /> : <Navigate to="/register" replace />)
                : <Navigate to="/login" replace />
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </AuthUsernameProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  );
};

export default App;
