import "./navigation.css";

type LoadingVariant = "public" | "admin" | "portal" | "booking" | "lesson";

function SkeletonLines() {
  return (
    <div className="route-skeleton-lines">
      <span className="route-skeleton route-skeleton-title" />
      <span className="route-skeleton" />
      <span className="route-skeleton route-skeleton-short" />
    </div>
  );
}

export function RouteLoading({
  title = "Sidan laddas",
  eyebrow = "Slowlax",
  description = "Innehållet visas strax.",
  variant = "public",
}: {
  title?: string;
  eyebrow?: string;
  description?: string;
  variant?: LoadingVariant;
}) {
  return (
    <section className={`route-loading route-loading--${variant}`} data-nosnippet="">
      <div className="route-loading-heading">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <p className="route-loading-title">{title}</p>
        <p>{description}</p>
        <p className="route-loading-status" role="status">
          <span className="route-loading-dot" aria-hidden="true" />
          Laddar…
        </p>
      </div>
      <div
        className={`route-loading-body route-loading-body--${variant}`}
        aria-hidden="true"
      >
        {variant === "admin" ? (
          <div className="route-skeleton-panel">
            <div className="route-skeleton-toolbar">
              <span className="route-skeleton route-skeleton-title" />
              <span className="route-skeleton route-skeleton-pill" />
            </div>
            {Array.from({ length: 5 }, (_, index) => (
              <div className="route-skeleton-row" key={index}>
                <span className="route-skeleton" />
                <span className="route-skeleton" />
                <span className="route-skeleton route-skeleton-pill" />
              </div>
            ))}
          </div>
        ) : variant === "booking" || variant === "lesson" ? (
          <>
            <div className="route-skeleton-panel">
              <SkeletonLines />
              <div className="route-skeleton-large" />
              <SkeletonLines />
            </div>
            <div className="route-skeleton-panel route-skeleton-aside">
              <SkeletonLines />
              <SkeletonLines />
              <span className="route-skeleton route-skeleton-pill" />
            </div>
          </>
        ) : (
          Array.from({ length: 3 }, (_, index) => (
            <div className="route-skeleton-card" key={index}>
              <div className="route-skeleton-cover" />
              <SkeletonLines />
            </div>
          ))
        )}
      </div>
    </section>
  );
}
