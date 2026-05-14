import RegistrationScreen from "@/components/onboarding/RegistrationScreen";
import { useAuthUsername } from "@/contexts/AuthUsernameContext";
import { hasDeviceProfile } from "@/services/deviceProfile";
import { useEffect, useMemo } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";

type Props = {
  onRegistered?: () => void;
};

const Register = ({ onRegistered }: Props) => {
  const navigate = useNavigate();
  const username = useAuthUsername();
  const [searchParams] = useSearchParams();
  const additional = useMemo(() => {
    const v = searchParams.get("additional");
    return v === "1" || v === "true";
  }, [searchParams]);

  useEffect(() => {
    if (!username) return;
    if (additional) return;
    if (!hasDeviceProfile(username)) return;
    onRegistered?.();
    navigate("/dashboard", { replace: true });
  }, [additional, username, navigate, onRegistered]);

  const handleSuccess = () => {
    onRegistered?.();
    if (additional) {
      navigate("/dashboard", { replace: true, state: { openSettings: true } });
    } else {
      navigate("/dashboard");
    }
  };

  if (!username) {
    return <Navigate to="/login" replace />;
  }

  return (
    <RegistrationScreen
      onSuccess={handleSuccess}
      registrationPurpose={additional ? "additional" : "initial"}
    />
  );
};

export default Register;

