export function TermName({ termId, label }: { termId: string; label?: string | null }) {
  return (
    <span className="term-name">
      <span>{label || termId}</span>
      {label && <small>{termId}</small>}
    </span>
  );
}
