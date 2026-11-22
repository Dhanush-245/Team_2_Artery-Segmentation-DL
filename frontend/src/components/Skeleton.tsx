/** Placeholder blocks shown while a section or its data loads. */
export function SkeletonBlock({ height = 16, width = "100%" }: { height?: number; width?: string }) {
  return <span className="cv-skeleton" style={{ height, width }} aria-hidden="true" />;
}

export default function SectionSkeleton({ label = "Loading workspace section…" }: { label?: string }) {
  return <div className="cv-skeleton-page" role="status" aria-live="polite">
    <span className="sr-only">{label}</span>
    <SkeletonBlock height={14} width="22%" />
    <SkeletonBlock height={30} width="46%" />
    <div className="cv-skeleton-grid">
      {[0, 1, 2].map((index) => <div key={index} className="cv-skeleton-card"><SkeletonBlock height={12} width="40%" /><SkeletonBlock height={24} width="65%" /><SkeletonBlock height={12} /><SkeletonBlock height={12} width="80%" /></div>)}
    </div>
    <div className="cv-skeleton-card"><SkeletonBlock height={14} width="30%" /><SkeletonBlock height={180} /></div>
  </div>;
}
