type QualityBadgeProps = {
  uncertainty: string;
  quality: string;
  synthetic: boolean;
  conditional: boolean;
};

export function QualityBadge({ uncertainty, quality, synthetic, conditional }: QualityBadgeProps) {
  const tone = [
    "quality-badge",
    synthetic ? "is-synthetic" : "",
    conditional ? "is-conditional" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={tone} data-testid="quality-badge" aria-live="polite">
      {synthetic || conditional ? (
        <p className="badge-flags">
          {synthetic ? <span>SYNTHETIC</span> : null}
          {conditional ? <span>CONDITIONAL</span> : null}
        </p>
      ) : null}
      <dl>
        <dt>uncertainty_status</dt>
        <dd>{uncertainty}</dd>
        <dt>data_quality</dt>
        <dd>{quality}</dd>
      </dl>
    </section>
  );
}
