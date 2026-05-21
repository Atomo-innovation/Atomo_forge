import RegistrationScreen from "@/components/onboarding/RegistrationScreen";
import { useAuthUsername } from "@/contexts/AuthUsernameContext";
import { hasDeviceProfile } from "@/services/deviceProfile";
import { hydrateDeviceProfileFromServer } from "@/services/deviceRegistrations";
import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

type Props = {
  onRegistered?: () => void;
};

const Register = ({ onRegistered }: Props) => {
  const navigate = useNavigate();
  const username = useAuthUsername();
  const [checkingExisting, setCheckingExisting] = useState(true);

  useEffect(() => {
    if (!username) {
      setCheckingExisting(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const registered =
        hasDeviceProfile(username) ||
        (await hydrateDeviceProfileFromServer(username));
      if (cancelled) return;
      if (registered) {
        onRegistered?.();
        navigate("/dashboard", { replace: true });
        return;
      }
      setCheckingExisting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [username, navigate, onRegistered]);

  const handleSuccess = () => {
    onRegistered?.();
    navigate("/dashboard", { replace: true });
  };

  if (!username) {
    return <Navigate to="/login" replace />;
  }

  if (checkingExisting) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return <RegistrationScreen onSuccess={handleSuccess} />;
};

export default Register;
