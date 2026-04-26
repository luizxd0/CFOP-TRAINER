import { formatMs } from "../lib/time";

export function CfopSplitBar({
  cross,
  f2l,
  oll,
  pll,
}: {
  cross: number | null;
  f2l: number | null;
  oll: number | null;
  pll: number | null;
}) {
  const segments = [
    { key: "cross", label: "Cross", value: cross },
    { key: "f2l", label: "F2L", value: f2l },
    { key: "oll", label: "OLL", value: oll },
    { key: "pll", label: "PLL", value: pll },
  ];
  const knownTotal = segments.reduce((sum, segment) => sum + (segment.value ?? 0), 0);
  const fallbackWidth = `${100 / segments.length}%`;

  return (
    <div className="cfop-split-bar" aria-label="CFOP split bar">
      {segments.map((segment) => {
        const width =
          knownTotal > 0 && segment.value !== null
            ? `${Math.max(8, (segment.value / knownTotal) * 100)}%`
            : fallbackWidth;
        return (
          <div
            className={`cfop-split-segment ${segment.key}`}
            key={segment.key}
            style={{ flexBasis: width }}
          >
            <span>{segment.label}</span>
            <strong>{segment.value === null ? "--" : formatMs(segment.value)}</strong>
          </div>
        );
      })}
    </div>
  );
}
