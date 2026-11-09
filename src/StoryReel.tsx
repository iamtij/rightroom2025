import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent, type PointerEvent } from "react";

export type MemberStory = {
  name: string;
  place: string;
  title: string;
  href: string;
  videoId: string;
  start: number;
  photo: string;
};

const PREVIEW_SECONDS = 8;

function previewSrc(videoId: string, start: number) {
  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    controls: "0",
    modestbranding: "1",
    rel: "0",
    playsinline: "1",
    start: String(start),
    end: String(start + PREVIEW_SECONDS),
    disablekb: "1",
    fs: "0",
    iv_load_policy: "3",
    cc_load_policy: "0",
    origin: window.location.origin,
  });
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params}`;
}

export default function StoryReel({ stories }: { stories: MemberStory[] }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const xRef = useRef(0);
  const reduceRef = useRef(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const pausedRef = useRef(reduceRef.current);
  const draggingRef = useRef(false);
  const nudgingRef = useRef(false);
  const coastRef = useRef(0);
  const movedRef = useRef(0);
  const offscreenRef = useRef(true);
  const cardStepRef = useRef(250);
  const motion = useRef({
    wrap: (value: number) => value,
    nudge: (_direction: number) => {},
    nearestKey: (): string | null => null,
  });
  const drag = useRef({ originX: 0, grabX: 0, lastX: 0, lastT: 0, velocity: 0 });
  const [liveKey, setLiveKey] = useState<string | null>(null);
  const liveKeyRef = useRef<string | null>(null);
  liveKeyRef.current = liveKey;
  const [previewReady, setPreviewReady] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  const count = stories.length;
  const liveName = liveKey?.slice(liveKey.indexOf("::") + 2) ?? "";
  const liveStory = stories.find((story) => story.name === liveName) ?? null;

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (track) track.style.transform = `translate3d(${xRef.current}px,0,0)`;
  });

  useEffect(() => {
    setPreviewReady(false);
  }, [liveKey]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      reduceRef.current = media.matches;
      if (media.matches) pausedRef.current = true;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    const viewport = viewportRef.current;
    if (!track || !viewport) return;
    let frame = 0;
    let last = 0;
    let alive = true;

    const measure = () => {
      const card = track.querySelector<HTMLElement>("[data-story-card]");
      if (!card) return;
      const gap = parseFloat(getComputedStyle(track).columnGap) || 14;
      cardStepRef.current = card.getBoundingClientRect().width + gap;
    };
    const wrap = (value: number) => {
      const width = cardStepRef.current * count;
      if (width <= 0) return 0;
      value %= width;
      if (value > 0) value -= width;
      return value;
    };
    const paint = () => {
      track.style.transform = `translate3d(${xRef.current}px,0,0)`;
    };

    motion.current.wrap = wrap;
    motion.current.nudge = (direction: number) => {
      measure();
      const start = xRef.current;
      const delta = direction * cardStepRef.current;
      coastRef.current = 0;
      if (reduceRef.current) {
        xRef.current = wrap(start + delta);
        paint();
        return;
      }
      const started = performance.now();
      nudgingRef.current = true;
      const step = (now: number) => {
        if (!alive) return;
        const progress = Math.min(1, (now - started) / 460);
        const eased = 1 - Math.pow(1 - progress, 3);
        xRef.current = wrap(start + delta * eased);
        paint();
        if (progress < 1) requestAnimationFrame(step);
        else nudgingRef.current = false;
      };
      requestAnimationFrame(step);
    };
    motion.current.nearestKey = () => {
      const box = viewport.getBoundingClientRect();
      const mid = box.left + box.width / 2;
      let best: string | null = null;
      let bestDist = Infinity;
      viewport.querySelectorAll<HTMLElement>("[data-story-card]").forEach((card) => {
        const rect = card.getBoundingClientRect();
        const dist = Math.abs(rect.left + rect.width / 2 - mid);
        if (dist < bestDist) {
          bestDist = dist;
          best = card.dataset.liveKey ?? null;
        }
      });
      return best;
    };

    const tick = (now: number) => {
      const dt = last ? Math.min(34, now - last) : 16;
      last = now;
      if (!draggingRef.current && !nudgingRef.current) {
        if (Math.abs(coastRef.current) > 0.02) {
          xRef.current = wrap(xRef.current + coastRef.current * dt);
          coastRef.current *= Math.exp(-dt / 220);
          if (Math.abs(coastRef.current) < 0.02) coastRef.current = 0;
        } else if (!pausedRef.current && !reduceRef.current && !offscreenRef.current) {
          xRef.current = wrap(xRef.current - 0.034 * dt);
        }
      }
      paint();
      frame = requestAnimationFrame(tick);
    };

    measure();
    paint();
    frame = requestAnimationFrame(tick);
    const observed = new ResizeObserver(measure);
    observed.observe(viewport);
    const seen = new IntersectionObserver(([entry]) => {
      offscreenRef.current = !entry.isIntersecting;
      if (!entry.isIntersecting) setLiveKey(null);
    });
    seen.observe(viewport);

    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observed.disconnect();
      seen.disconnect();
    };
  }, [count]);

  function pause() {
    pausedRef.current = true;
    coastRef.current = 0;
  }

  function resumeIfIdle() {
    if (draggingRef.current) return;
    const active = document.activeElement;
    if (active && trackRef.current?.contains(active)) return;
    pausedRef.current = reduceRef.current;
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    draggingRef.current = true;
    nudgingRef.current = false;
    coastRef.current = 0;
    movedRef.current = 0;
    drag.current.grabX = event.clientX;
    drag.current.originX = xRef.current;
    drag.current.lastX = event.clientX;
    drag.current.lastT = performance.now();
    drag.current.velocity = 0;
    setGrabbing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    const now = performance.now();
    const dt = now - drag.current.lastT || 16;
    drag.current.velocity = (event.clientX - drag.current.lastX) / dt;
    drag.current.lastX = event.clientX;
    drag.current.lastT = now;
    movedRef.current = event.clientX - drag.current.grabX;
    xRef.current = motion.current.wrap(drag.current.originX + movedRef.current);
    if (trackRef.current) trackRef.current.style.transform = `translate3d(${xRef.current}px,0,0)`;
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setGrabbing(false);
    const moved = movedRef.current;
    if (!reduceRef.current && Math.abs(moved) > 8) {
      coastRef.current = Math.max(-1.4, Math.min(1.4, drag.current.velocity));
    }
    if (Math.abs(moved) <= 8) return;
    if (event.pointerType === "touch") {
      const key = motion.current.nearestKey();
      if (key) setLiveKey(key);
      return;
    }
    const node = document.elementFromPoint(event.clientX, event.clientY);
    const card = node instanceof Element ? node.closest("[data-story-card]") : null;
    if (card instanceof HTMLElement && card.dataset.liveKey) setLiveKey(card.dataset.liveKey);
  }

  function onCardClick(event: MouseEvent<HTMLAnchorElement>) {
    if (Math.abs(movedRef.current) > 8) {
      event.preventDefault();
      movedRef.current = 0;
    }
  }

  function showCard(key: string, card?: HTMLElement) {
    pause();
    if (card && viewportRef.current) {
      const view = viewportRef.current.getBoundingClientRect();
      const rect = card.getBoundingClientRect();
      if (rect.left < view.left + 8 || rect.right > view.right - 8) {
        xRef.current = motion.current.wrap(xRef.current - (rect.left - view.left - 24));
        if (trackRef.current) trackRef.current.style.transform = `translate3d(${xRef.current}px,0,0)`;
      }
    }
    setLiveKey(key);
  }

  function onCardFocus(key: string, event: FocusEvent<HTMLAnchorElement>) {
    if (draggingRef.current) return;
    showCard(key, event.currentTarget);
  }

  function onCardBlur(key: string, event: FocusEvent<HTMLAnchorElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setLiveKey((current) => (current === key ? null : current));
    resumeIfIdle();
  }

  return (
    <div
      className="story-reel relative"
      role="region"
      aria-roledescription="carousel"
      aria-label="Member stories"
      onPointerEnter={pause}
      onPointerLeave={(event) => {
        if (draggingRef.current) return;
        if (event.pointerType === "touch") {
          if (Math.abs(movedRef.current) <= 8) resumeIfIdle();
          return;
        }
        setLiveKey(null);
        resumeIfIdle();
      }}
    >
      <p className="sr-only">The row moves on its own. Drag it, or use previous and next. Focusing a story plays a short preview.</p>
      <div
        ref={viewportRef}
        className={`overflow-hidden py-3 touch-pan-y ${grabbing ? "cursor-grabbing" : "cursor-grab"}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div ref={trackRef} className="flex w-max select-none gap-3.5 px-4 sm:px-8 lg:px-24">
          {[0, 1].map((copy) =>
            stories.map((story) => {
              const key = `${copy}::${story.name}`;
              const live = liveKey === key;
              return (
                <a
                  key={key}
                  href={story.href}
                  target="_blank"
                  rel="noreferrer"
                  draggable={false}
                  data-story-card
                  data-live-key={key}
                  tabIndex={copy === 1 ? -1 : undefined}
                  aria-hidden={copy === 1 ? true : undefined}
                  onClick={onCardClick}
                  onPointerOver={(event) => {
                    if (event.pointerType !== "mouse" || draggingRef.current) return;
                    showCard(key);
                  }}
                  onPointerOut={(event) => {
                    if (event.pointerType !== "mouse") return;
                    const next = event.relatedTarget;
                    if (next instanceof Node && event.currentTarget.contains(next)) return;
                    setLiveKey((current) => (current === key ? null : current));
                  }}
                  onFocus={(event) => onCardFocus(key, event)}
                  onBlur={(event) => onCardBlur(key, event)}
                  className={`story-card relative block aspect-[720/1030] w-[clamp(180px,58vw,236px)] shrink-0 touch-pan-y overflow-hidden rounded-2xl bg-[#141416] text-white no-underline shadow-[0_12px_28px_rgba(20,20,22,0.14)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[#D0202E] ${grabbing ? "cursor-grabbing" : "cursor-pointer"} ${live ? "is-live" : ""}`}
                >
                  <img src={story.photo} alt="" draggable={false} className="story-still absolute inset-0 h-full w-full object-cover" />
                  {live ? (
                    <iframe
                      title={`Preview of ${story.name}`}
                      src={previewSrc(story.videoId, story.start)}
                      className={`pointer-events-none absolute top-[-18%] left-1/2 z-0 aspect-video h-[125%] w-auto max-w-none -translate-x-1/2 border-0 transition-opacity duration-300 ${previewReady ? "opacity-100" : "opacity-0"}`}
                      allow="autoplay; encrypted-media"
                      referrerPolicy="strict-origin-when-cross-origin"
                      tabIndex={-1}
                      aria-hidden="true"
                      onLoad={() => {
                        if (liveKeyRef.current === key) setPreviewReady(true);
                      }}
                    />
                  ) : null}
                  <span aria-hidden="true" className="story-shade absolute inset-0" />
                  <span aria-hidden="true" className={`absolute top-3 right-3 z-[1] grid h-8 w-8 place-items-center rounded-full bg-[rgba(10,10,12,0.62)] text-white transition-opacity ${live ? "opacity-0" : ""}`}>
                    <svg width="11" height="11" viewBox="0 0 12 12">
                      <path d="M3.1 1.6v8.8L10.4 6 3.1 1.6Z" fill="currentColor" />
                    </svg>
                  </span>
                  <span className="absolute inset-x-0 bottom-0 z-[1] flex flex-col gap-1 px-3.5 pt-16 pb-4">
                    <span className="text-lg font-bold leading-tight">{story.name}</span>
                    <span className="text-xs font-semibold text-[#FFD5D8]">{story.place}</span>
                    <span className="mt-1 text-[15px] leading-snug">{story.title}</span>
                  </span>
                  <span aria-hidden="true" className="story-preview-bar absolute inset-x-0 bottom-0 z-[2] h-[3px] bg-[#D0202E]" />
                  <span className="sr-only">Watch on YouTube</span>
                </a>
              );
            }),
          )}
        </div>
      </div>
      <button
        type="button"
        aria-label="Previous stories"
        className="absolute top-1/2 left-3 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-[#E4E1DC] bg-white text-[#141416] shadow-[0_6px_16px_rgba(20,20,22,0.14)]"
        onClick={() => motion.current.nudge(1)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M10.2 2.8 5 8l5.2 5.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Next stories"
        className="absolute top-1/2 right-3 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-[#E4E1DC] bg-white text-[#141416] shadow-[0_6px_16px_rgba(20,20,22,0.14)]"
        onClick={() => motion.current.nudge(-1)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M5.8 2.8 11 8l-5.2 5.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <p className="sr-only" aria-live="polite">{liveStory ? `Preview, ${liveStory.name}.` : ""}</p>
    </div>
  );
}
