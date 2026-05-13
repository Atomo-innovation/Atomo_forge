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

const queryClient = new QueryClient();

const App = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(() => readLoggedIn());
  // True only after the user has explicitly completed /register in THIS
  // app session. Resets on full page reload so login -> register always runs.
  const [didRegisterThisSession, setDidRegisterThisSession] = useState(false);

  const handleLoginSuccess = () => {
    setLoggedIn(true);
    setIsLoggedIn(true);
    setDidRegisterThisSession(false);
  };

  const handleOnboardingComplete = () => {
    setLoggedIn(true);
    setIsLoggedIn(true);
  };

  const handleRegistrationComplete = () => {
    setDidRegisterThisSession(true);
  };

  // Canonical post-login destination. Order is always:
  //   1) /login  →  2) /register  →  3) /dashboard
  // /register is only skipped after the user finished registration in
  // this app session (clicked Save in RegistrationScreen).
  const postLoginPath = () => (didRegisterThisSession ? "/dashboard" : "/register");

  return (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
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
                ? (didRegisterThisSession ? <Dashboard /> : <Navigate to="/register" replace />)
                : <Navigate to="/login" replace />
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  );
};

export default App;
