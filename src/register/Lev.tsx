import type { ReactNode } from "react";

export type LevPose = "smile" | "wink" | "focus" | "thumb" | "alert";

const LIT_BARS: Record<LevPose, number> = {
  smile: 2,
  wink: 3,
  focus: 4,
  thumb: 1,
  alert: 2,
};

const BAR_ROWS = [
  { y: 234, delay: "0.30s" },
  { y: 213, delay: "0.55s" },
  { y: 192, delay: "0.80s" },
  { y: 171, delay: "1.05s" },
  { y: 150, delay: "1.30s" },
];

function Ground({ alert = false }: { alert?: boolean }) {
  return (
    <>
      <ellipse cx="200" cy="314" rx="100" ry="11" fill={alert ? "#EBC9CC" : "#E6DEDA"} />
      <rect x="168" y="254" width="20" height="48" rx="8" fill="#D0202E" />
      <rect x="212" y="254" width="20" height="48" rx="8" fill="#D0202E" />
      <ellipse cx="174" cy="304" rx="24" ry="10" fill="#FFFFFF" stroke="#12234A" strokeWidth="4" />
      <ellipse cx="226" cy="304" rx="24" ry="10" fill="#FFFFFF" stroke="#12234A" strokeWidth="4" />
    </>
  );
}

function Torso({ children }: { children?: ReactNode }) {
  return (
    <>
      <rect x="145" y="58" width="110" height="208" rx="24" fill="#D0202E" />
      <rect x="160" y="74" width="80" height="62" rx="14" fill="#FFFFFF" />
      {children}
    </>
  );
}

function Bars({ lit, warn = false }: { lit: number; warn?: boolean }) {
  return (
    <>
      {BAR_ROWS.map((bar, index) => {
        const on = index < lit;
        const fill = on ? (warn && index === 1 ? "#12234A" : "#FFC93C") : "#A8131F";
        return (
          <rect
            key={bar.y}
            className={on ? "bar-lit" : undefined}
            style={on ? { animationDelay: bar.delay } : undefined}
            x="162"
            y={bar.y}
            width="76"
            height="16"
            rx="4"
            fill={fill}
          />
        );
      })}
    </>
  );
}

function DownArms() {
  return (
    <>
      <g className="arm-l" style={{ transformOrigin: "150px 200px" }}>
        <path d="M150 200 Q118 220 112 256" stroke="#D0202E" strokeWidth="12" strokeLinecap="round" fill="none" />
        <circle cx="112" cy="264" r="13" fill="#F6F4F1" stroke="#D0202E" strokeWidth="4" />
      </g>
      <g className="arm-r" style={{ transformOrigin: "250px 200px" }}>
        <path d="M250 200 Q282 220 288 256" stroke="#D0202E" strokeWidth="12" strokeLinecap="round" fill="none" />
        <circle cx="288" cy="264" r="13" fill="#F6F4F1" stroke="#D0202E" strokeWidth="4" />
      </g>
    </>
  );
}

function Sparks({ paths }: { paths: string[] }) {
  return (
    <>
      {paths.map((d) => (
        <path key={d} className="spark" d={d} stroke="#FF4D5A" strokeWidth="6" strokeLinecap="round" />
      ))}
    </>
  );
}

function Scene({ label, children }: { label: string; children: ReactNode }) {
  return (
    <svg className="lev shrink-0" role="img" aria-label={label} width="64" height="66" viewBox="40 10 320 330">
      {children}
    </svg>
  );
}

export function Lev({ pose, label, bars }: { pose: LevPose; label: string; bars?: number }) {
  const lit = bars ?? LIT_BARS[pose];
  if (pose === "wink") {
    return (
      <Scene label={label}>
        <Ground />
        <g className="arm-l" style={{ transformOrigin: "150px 200px" }}>
          <path d="M150 200 Q118 220 112 256" stroke="#D0202E" strokeWidth="12" strokeLinecap="round" fill="none" />
          <circle cx="112" cy="264" r="13" fill="#F6F4F1" stroke="#D0202E" strokeWidth="4" />
        </g>
        <g className="arm-r" style={{ transformOrigin: "250px 190px" }}>
          <path d="M250 190 Q292 180 296 132" stroke="#D0202E" strokeWidth="12" strokeLinecap="round" fill="none" />
          <circle cx="296" cy="128" r="13" fill="#F6F4F1" stroke="#D0202E" strokeWidth="4" />
          <rect x="291" y="96" width="10" height="26" rx="5" fill="#F6F4F1" stroke="#D0202E" strokeWidth="4" />
        </g>
        <Torso>
          <path d="M175 100 Q183 92 191 100" stroke="#12234A" strokeWidth="5" strokeLinecap="round" fill="none" />
          <ellipse className="eye" cx="217" cy="98" rx="7" ry="10" fill="#12234A" />
          <path d="M185 117 Q200 129 215 117" stroke="#12234A" strokeWidth="5" strokeLinecap="round" fill="none" />
          <Bars lit={lit} />
        </Torso>
        <Sparks paths={["M296 76 L296 62", "M316 84 L326 74", "M276 84 L266 74"]} />
      </Scene>
    );
  }
  if (pose === "focus") {
    return (
      <Scene label={label}>
        <Ground />
        <Torso>
          <path d="M174 86 L190 89" stroke="#12234A" strokeWidth="4" strokeLinecap="round" />
          <path d="M226 86 L210 89" stroke="#12234A" strokeWidth="4" strokeLinecap="round" />
          <ellipse className="eye" cx="183" cy="101" rx="7" ry="8" fill="#12234A" />
          <ellipse className="eye" cx="217" cy="101" rx="7" ry="8" fill="#12234A" />
          <path d="M189 121 L211 121" stroke="#12234A" strokeWidth="5" strokeLinecap="round" />
          <Bars lit={lit} />
        </Torso>
        <g className="hold">
          <path d="M150 210 Q124 250 164 268" stroke="#D0202E" strokeWidth="12" strokeLinecap="round" fill="none" />
          <path d="M250 210 Q276 250 236 268" stroke="#D0202E" strokeWidth="12" strokeLinecap="round" fill="none" />
          <rect x="160" y="238" width="80" height="50" rx="8" fill="#12234A" />
          <rect x="160" y="250" width="80" height="9" fill="#0A1530" />
          <rect x="170" y="270" width="26" height="7" rx="3" fill="#8C99B8" />
          <circle cx="164" cy="270" r="12" fill="#F6F4F1" stroke="#D0202E" strokeWidth="4" />
          <circle cx="236" cy="270" r="12" fill="#F6F4F1" stroke="#D0202E" strokeWidth="4" />
        </g>
      </Scene>
    );
  }
  if (pose === "thumb") {
    return (
      <Scene label={label}>
        <Ground />
        <g className="arm-l" style={{ transformOrigin: "150px 200px" }}>
          <path d="M150 200 Q118 220 112 256" stroke="#D0202E" strokeWidth="12" strokeLinecap="round" fill="none" />
          <circle cx="112" cy="264" r="13" fill="#F6F4F1" stroke="#D0202E" strokeWidth="4" />
        </g>
        <g className="thumb" style={{ transformOrigin: "250px 200px" }}>
          <path d="M250 200 Q296 196 300 160" stroke="#D0202E" strokeWidth="12" strokeLinecap="round" fill="none" />
          <rect x="295" y="124" width="10" height="24" rx="5" fill="#F6F4F1" stroke="#D0202E" strokeWidth="4" />
          <circle cx="300" cy="154" r="13" fill="#F6F4F1" stroke="#D0202E" strokeWidth="4" />
        </g>
        <Torso>
          <ellipse className="eye" cx="183" cy="98" rx="7" ry="10" fill="#12234A" />
          <ellipse className="eye" cx="217" cy="98" rx="7" ry="10" fill="#12234A" />
          <path d="M184 115 Q200 131 216 115" stroke="#12234A" strokeWidth="5" strokeLinecap="round" fill="none" />
          <Bars lit={lit} />
        </Torso>
      </Scene>
    );
  }
  if (pose === "alert") {
    return (
      <Scene label={label}>
        <Ground alert />
        <g className="arm-l" style={{ transformOrigin: "150px 200px" }}>
          <path d="M150 200 Q118 220 112 256" stroke="#D0202E" strokeWidth="12" strokeLinecap="round" fill="none" />
          <circle cx="112" cy="264" r="13" fill="#F6F4F1" stroke="#D0202E" strokeWidth="4" />
        </g>
        <g className="arm-r" style={{ transformOrigin: "250px 190px" }}>
          <path d="M250 190 Q284 176 282 136" stroke="#D0202E" strokeWidth="12" strokeLinecap="round" fill="none" />
          <circle cx="282" cy="128" r="13" fill="#F6F4F1" stroke="#D0202E" strokeWidth="4" />
        </g>
        <Torso>
          <path d="M174 88 L190 83" stroke="#12234A" strokeWidth="4" strokeLinecap="round" />
          <path d="M210 83 L226 88" stroke="#12234A" strokeWidth="4" strokeLinecap="round" />
          <ellipse className="eye" cx="183" cy="101" rx="7" ry="10" fill="#12234A" />
          <ellipse className="eye" cx="217" cy="101" rx="7" ry="10" fill="#12234A" />
          <circle cx="200" cy="124" r="5" fill="#12234A" />
          <Bars lit={lit} warn />
        </Torso>
        <g className="ping">
          <circle cx="318" cy="72" r="26" fill="#12234A" />
          <rect x="314" y="56" width="8" height="22" rx="4" fill="#FFFFFF" />
          <circle cx="318" cy="86" r="4" fill="#FFFFFF" />
        </g>
      </Scene>
    );
  }
  return (
    <Scene label={label}>
      <Ground />
      <DownArms />
      <Torso>
        <path d="M175 101 Q183 89 191 101" stroke="#12234A" strokeWidth="5" strokeLinecap="round" fill="none" />
        <path d="M209 101 Q217 89 225 101" stroke="#12234A" strokeWidth="5" strokeLinecap="round" fill="none" />
        <path d="M184 114 Q200 132 216 114 Z" fill="#12234A" />
        <Bars lit={lit} />
      </Torso>
      <Sparks paths={["M272 70 L290 58", "M278 96 L300 92", "M128 70 L110 58", "M122 96 L100 92"]} />
    </Scene>
  );
}

export function LevNote({
  pose,
  label,
  bars,
  children,
}: {
  pose: LevPose;
  label: string;
  bars?: number;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Lev pose={pose} label={label} bars={bars} />
      <p className="m-0 flex-1 rounded-[4px_16px_16px_16px] border border-[#E4E1DC] bg-white px-3 py-2.5 text-sm leading-snug text-[#2A2A2E]">
        {children}
      </p>
    </div>
  );
}
