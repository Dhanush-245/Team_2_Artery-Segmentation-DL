export default function LoadingScreen({ label = "Loading your workspace…" }: { label?: string }) {
  return <div className="cv-loading-screen" role="status">
    <span className="cv-loading-bars" aria-hidden="true" />
    <span>{label}</span>
  </div>;
}
