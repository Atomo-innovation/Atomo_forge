import RegistrationScreen from "@/components/onboarding/RegistrationScreen";
import { useNavigate } from "react-router-dom";

type Props = {
  onRegistered?: () => void;
};

const Register = ({ onRegistered }: Props) => {
  const navigate = useNavigate();

  // After a successful registration, mark the app-level "registered this
  // session" flag (so /dashboard becomes reachable) and jump to it.
  const handleSuccess = () => {
    onRegistered?.();
    navigate("/dashboard");
  };

  return <RegistrationScreen onSuccess={handleSuccess} />;
};

export default Register;

