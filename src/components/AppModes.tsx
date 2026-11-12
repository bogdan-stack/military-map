import Link from "next/link";

/** Map stays mounted. Plan opens the cockpit; it does not leave the map. */
export function AppModes({
  current,
  onMap,
  onPlan,
}: {
  current: "map" | "plan";
  onMap?: () => void;
  onPlan?: () => void;
}) {
  return (
    <nav className="app-modes" aria-label="Planning">
      {onMap && onPlan ? (
        <>
          <button type="button" aria-current={current === "map" ? "page" : undefined} onClick={onMap}>
            Map
          </button>
          <button type="button" aria-current={current === "plan" ? "page" : undefined} onClick={onPlan}>
            Plan
          </button>
        </>
      ) : (
        <>
          <Link href="/" aria-current={current === "map" ? "page" : undefined}>
            Map
          </Link>
          <Link href="/plan" aria-current={current === "plan" ? "page" : undefined}>
            Plan
          </Link>
        </>
      )}
    </nav>
  );
}
