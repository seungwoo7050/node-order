import type { ReactNode } from "react";

export function SkeletonGrid({
  count = 8,
  gridClassName,
  cardClassName,
  plateClassName,
  lineClassName,
}: {
  count?: number;
  gridClassName?: string;
  cardClassName?: string;
  plateClassName?: string;
  lineClassName?: string;
}) {
  return (
    <div className={gridClassName} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={cardClassName}>
          <span className={plateClassName} />
          <span className={lineClassName} />
          <span className={lineClassName} />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title = "상품이 없습니다.",
  actionLabel = "전체 보기",
  onReset,
  className,
  titleClassName,
  actionClassName,
  children,
}: {
  title?: string;
  actionLabel?: string;
  onReset?: () => void;
  className?: string;
  titleClassName?: string;
  actionClassName?: string;
  children?: ReactNode;
}) {
  return (
    <div className={className}>
      <p className={titleClassName}>{title}</p>
      {onReset && (
        <button type="button" onClick={onReset} className={actionClassName}>
          {actionLabel}
        </button>
      )}
      {children}
    </div>
  );
}
