import RegistrationScreen from "@/components/onboarding/RegistrationScreen";
import { useNavigate } from "react-router-dom";

const Register = () => {
  const navigate = useNavigate();

  // After a successful registration, jump straight to the dashboard. The
  // dashboard top bar reads the device profile saved by RegistrationScreen
  // and displays the device name / organization / serial.
  return <RegistrationScreen onSuccess={() => navigate("/dashboard")} />;
};

export default Register;

