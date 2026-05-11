const AtomAnimation = () => {
  return (
    <div className="w-[500px] h-[500px] relative animate-spin-slow opacity-[0.07]">
      {/* Orbit 1 */}
      <div className="absolute inset-0 border border-primary/40 rounded-full" />
      {/* Orbit 2 */}
      <div className="absolute inset-8 border border-accent/30 rounded-full rotate-45" />
      {/* Orbit 3 */}
      <div className="absolute inset-16 border border-primary/20 rounded-full -rotate-12" />
      {/* Core */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-gradient-atomic animate-pulse-glow" />
      {/* Electron dots */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-primary animate-pulse-glow" />
      <div className="absolute bottom-8 right-8 w-2 h-2 rounded-full bg-accent animate-pulse-glow" style={{ animationDelay: "1s" }} />
      <div className="absolute bottom-16 left-8 w-2 h-2 rounded-full bg-primary animate-pulse-glow" style={{ animationDelay: "2s" }} />
    </div>
  );
};

export default AtomAnimation;
