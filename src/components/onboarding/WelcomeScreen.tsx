import atomoLogo from "@/assets/atomo-logo-light.png";
import AtomAnimation from "./AtomAnimation";

interface WelcomeScreenProps {
  onGetStarted: () => void;
}

const WelcomeScreen = ({ onGetStarted }: WelcomeScreenProps) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 relative">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <AtomAnimation />
      </div>

      <div className="relative z-10 flex flex-col items-center text-center max-w-xl">
        <img
          src={atomoLogo}
          alt="Atomo"
          className="h-16 mb-12 opacity-0 animate-fade-in"
        />

        <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-4 opacity-0 animate-fade-in-up"
          style={{ animationDelay: "0.2s" }}>
          Welcome to{" "}
          <span className="text-gradient">Atomo</span>
        </h1>

        <p className="text-lg text-muted-foreground mb-12 opacity-0 animate-fade-in-up"
          style={{ animationDelay: "0.4s" }}>
          Powering Physical AI at the Edge.
        </p>

        <div className="flex gap-4 opacity-0 animate-fade-in-up" style={{ animationDelay: "0.6s" }}>
          <button
            onClick={onGetStarted}
            className="px-8 py-3.5 rounded-lg bg-gradient-atomic font-semibold text-primary-foreground glow-primary transition-all duration-300 hover:scale-105 hover:shadow-lg"
          >
            Get Started
          </button>
          <button className="px-8 py-3.5 rounded-lg border border-border font-semibold text-secondary-foreground hover:bg-secondary transition-all duration-300">
            Learn More
          </button>
        </div>
      </div>
    </div>
  );
};

export default WelcomeScreen;
