/**
 * Decorative geometry.
 *
 * Everything here is abstract "data geometry" — arcs, measurement ticks,
 * scatter, converging paths — rather than generic blobs, so the ornament still
 * reads as belonging to a reconciliation tool. All of it is aria-hidden,
 * pointer-events-none, absolutely positioned inside a clipped host, and never
 * contributes to layout width.
 */

const INK = "#14161A";
const SIGNAL = "#0F5F55";
const MATCHED = "#2E6F4E";
const EXPLAINED = "#9A6511";
const FLAGGED = "#A8362C";

/** Full-page ambient wash. Rendered once in the layout, fixed behind content. */
export function BackdropField() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      {/* Soft colour washes — the only large-area colour in the app. */}
      <div
        className="decor -right-40 -top-40 h-[34rem] w-[34rem] animate-drift rounded-full opacity-[0.07] blur-3xl"
        style={{ background: `radial-gradient(circle, ${SIGNAL} 0%, transparent 68%)` }}
      />
      <div
        className="decor -left-52 top-[28rem] h-[30rem] w-[30rem] animate-driftAlt rounded-full opacity-[0.06] blur-3xl"
        style={{ background: `radial-gradient(circle, ${EXPLAINED} 0%, transparent 68%)` }}
      />
      <div
        className="decor bottom-[-14rem] right-[6rem] h-[26rem] w-[26rem] animate-drift rounded-full opacity-[0.05] blur-3xl"
        style={{ background: `radial-gradient(circle, ${FLAGGED} 0%, transparent 70%)` }}
      />

      {/* Concentric rings, top right. */}
      <svg
        className="decor right-[-9rem] top-[3rem] h-[26rem] w-[26rem] animate-driftAlt"
        viewBox="0 0 400 400"
        fill="none"
      >
        {[60, 105, 150, 195].map((r, i) => (
          <circle
            key={r}
            cx="200"
            cy="200"
            r={r}
            stroke={INK}
            strokeOpacity={0.07 - i * 0.012}
            strokeWidth="1"
            strokeDasharray={i % 2 ? "3 7" : undefined}
          />
        ))}
        <circle cx="200" cy="200" r="4" fill={SIGNAL} fillOpacity="0.18" />
      </svg>

      {/* Measurement ticks running down the left edge. */}
      <svg className="decor left-6 top-[16rem] hidden h-[30rem] w-8 lg:block" viewBox="0 0 32 480" fill="none">
        {Array.from({ length: 24 }).map((_, i) => (
          <line
            key={i}
            x1="0"
            y1={i * 20 + 4}
            x2={i % 4 === 0 ? 22 : 10}
            y2={i * 20 + 4}
            stroke={INK}
            strokeOpacity={i % 4 === 0 ? 0.1 : 0.055}
            strokeWidth="1"
          />
        ))}
      </svg>
    </div>
  );
}

/**
 * Hero diagram: five evidence sources converging through the resolver and
 * fanning out into three buckets. Strokes draw themselves in on mount.
 */
export function ResolverDiagram({ className = "" }: { className?: string }) {
  const sources = [
    { y: 46, label: "settlement" },
    { y: 106, label: "bank" },
    { y: 166, label: "order" },
    { y: 226, label: "shipment" },
    { y: 286, label: "chat log" },
  ];
  const outcomes = [
    { y: 86, color: MATCHED },
    { y: 166, color: EXPLAINED },
    { y: 246, color: FLAGGED },
  ];

  return (
    <svg
      className={className}
      viewBox="-56 0 616 332"
      fill="none"
      role="img"
      aria-label="Five evidence sources converging through the resolver into three outcome buckets"
    >
      {/* Source → resolver */}
      {sources.map((s, i) => (
        <g key={s.label}>
          <path
            d={`M 74 ${s.y} C 160 ${s.y} 190 166 258 166`}
            stroke={INK}
            strokeOpacity="0.22"
            strokeWidth="1.25"
            strokeDasharray="420"
            className="animate-drawIn"
            style={{ ["--dash" as string]: "420", animationDelay: `${i * 110}ms` }}
          />
          <circle
            cx="74"
            cy={s.y}
            r="4.5"
            fill={SIGNAL}
            className="animate-popIn"
            style={{ animationDelay: `${i * 110}ms` }}
          />
          <text
            x="60"
            y={s.y + 4}
            textAnchor="end"
            className="animate-settle"
            style={{ animationDelay: `${i * 110 + 120}ms` }}
            fill={INK}
            fillOpacity="0.5"
            fontSize="11"
            fontFamily="var(--font-mono), monospace"
            letterSpacing="0.06em"
          >
            {s.label}
          </text>
        </g>
      ))}

      {/* Resolver node */}
      <g className="animate-popIn" style={{ animationDelay: "560ms" }}>
        <circle cx="286" cy="166" r="34" fill="#FBFAF6" stroke={SIGNAL} strokeOpacity="0.35" />
        <circle cx="286" cy="166" r="24" stroke={SIGNAL} strokeOpacity="0.2" strokeDasharray="2 6" />
        <circle cx="286" cy="166" r="7" fill={SIGNAL} fillOpacity="0.85" />
      </g>

      {/* Resolver → outcomes */}
      {outcomes.map((o, i) => (
        <g key={o.y}>
          <path
            d={`M 320 166 C 386 166 400 ${o.y} 470 ${o.y}`}
            stroke={o.color}
            strokeOpacity="0.55"
            strokeWidth="1.5"
            strokeDasharray="260"
            className="animate-drawIn"
            style={{ ["--dash" as string]: "260", animationDelay: `${700 + i * 130}ms` }}
          />
          <circle
            cx="470"
            cy={o.y}
            r="6"
            fill={o.color}
            fillOpacity="0.9"
            className="animate-popIn"
            style={{ animationDelay: `${900 + i * 130}ms` }}
          />
          {/* Confidence tick scale beside each outcome */}
          {[0, 1, 2, 3].map((t) => (
            <line
              key={t}
              x1={488 + t * 9}
              y1={o.y - 5}
              x2={488 + t * 9}
              y2={o.y + 5}
              stroke={o.color}
              strokeOpacity={0.42 - t * 0.09}
              strokeWidth="2"
              strokeLinecap="round"
              className="animate-settle"
              style={{ animationDelay: `${980 + i * 130 + t * 60}ms` }}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}

/** Concentric quarter-arcs. Section accent. */
export function ArcCluster({ className = "", tone = SIGNAL }: { className?: string; tone?: string }) {
  return (
    <svg className={className} viewBox="0 0 240 240" fill="none" aria-hidden>
      {[40, 72, 104, 136, 168].map((r, i) => (
        <path
          key={r}
          d={`M 0 ${240 - r} A ${r} ${r} 0 0 1 ${r} 240`}
          stroke={tone}
          strokeOpacity={0.3 - i * 0.045}
          strokeWidth="1.25"
        />
      ))}
    </svg>
  );
}

/** Scatter of small marks, like plotted transactions. */
export function ScatterField({ className = "" }: { className?: string }) {
  const pts = [
    [18, 60], [46, 28], [72, 84], [104, 44], [132, 96], [158, 22],
    [186, 70], [212, 38], [238, 92], [264, 54], [292, 18], [318, 78],
  ];
  return (
    <svg className={className} viewBox="0 0 340 120" fill="none" aria-hidden>
      {pts.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={i % 5 === 0 ? 3.5 : 2}
          fill={i % 5 === 0 ? SIGNAL : INK}
          fillOpacity={i % 5 === 0 ? 0.35 : 0.16}
        />
      ))}
      <path
        d="M 8 96 C 90 78 170 54 332 24"
        stroke={SIGNAL}
        strokeOpacity="0.22"
        strokeWidth="1.25"
        strokeDasharray="4 6"
      />
    </svg>
  );
}

/** A confidence dial, used to decorate the pre-run states. */
export function ConfidenceDial({
  className = "",
  value = 0.72,
  tone = SIGNAL,
}: {
  className?: string;
  value?: number;
  tone?: string;
}) {
  const r = 52;
  const circumference = Math.PI * r; // half circle
  return (
    <svg className={className} viewBox="0 0 140 84" fill="none" aria-hidden>
      <path
        d={`M 18 70 A ${r} ${r} 0 0 1 122 70`}
        stroke={INK}
        strokeOpacity="0.1"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d={`M 18 70 A ${r} ${r} 0 0 1 122 70`}
        stroke={tone}
        strokeOpacity="0.75"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - value)}
        className="animate-drawIn"
        style={{ ["--dash" as string]: `${circumference}` }}
      />
      {/* 60% flag threshold */}
      <line x1="70" y1="12" x2="70" y2="22" stroke={INK} strokeOpacity="0.3" strokeWidth="2" />
    </svg>
  );
}
