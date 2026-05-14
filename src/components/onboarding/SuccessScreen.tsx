import { useNavigate } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";

const SuccessScreen = ({
  onComplete,
  meshUsername,
}: {
  onComplete?: (meshUsername?: string | null) => void;
  meshUsername?: string | null;
}) => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
      <div className="opacity-0 animate-scale-in">
        <div className="w-24 h-24 rounded-full bg-gradient-atomic flex items-center justify-center mb-8 mx-auto glow-primary">
          <CheckCircle2 className="w-12 h-12 text-primary-foreground" />
        </div>
      </div>

      <h1 className="text-4xl font-bold mb-3 opacity-0 animate-fade-in-up" style={{ animationDelay: "0.3s" }}>
        Your Atomo Device is Ready.
      </h1>
      <p className="text-muted-foreground text-lg mb-10 opacity-0 animate-fade-in-up" style={{ animationDelay: "0.5s" }}>
        Device registered successfully. Let's set up your first camera.
      </p>

      <button
        onClick={() => {
          if (onComplete) onComplete(meshUsername);
          navigate("/dashboard");
        }}
        className="px-8 py-3.5 rounded-lg bg-gradient-atomic font-semibold text-primary-foreground glow-primary-sm transition-all duration-300 hover:scale-105 opacity-0 animate-fade-in-up"
        style={{ animationDelay: "0.7s" }}
      >
        Go to Overview
      </button>
    </div>
  );
};

export default SuccessScreen;
