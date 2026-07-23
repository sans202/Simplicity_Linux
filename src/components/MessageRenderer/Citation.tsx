'use client';

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { Chunk } from '@/lib/types';
import { faviconUrl, getDomainLabel, getHost, isFileSource } from './sourceUtils';

/**
 * Renders `<citation idx="1,2,5">` produced by annotateCitations.
 *
 * `idx` is guaranteed (by annotateCitations) to be a comma-separated list of
 * 1-based indices already validated against `sources.length`, but this
 * component re-validates defensively -- if resolution still fails for any
 * reason it renders nothing rather than a broken chip, never touching
 * surrounding text (it's a self-contained inline element).
 */
const Citation = ({
  idx,
  sources = [],
}: {
  idx?: string;
  sources?: Chunk[];
}) => {
  const indices = (idx ?? '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= sources.length);

  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  if (indices.length === 0) return null;

  const group = indices.map((number) => ({ number, chunk: sources[number - 1] }));
  const primary = group[0];
  const primaryHost = getHost(primary.chunk?.metadata?.url);

  const openNow = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };

  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  const active = group[Math.min(activeIdx, group.length - 1)];
  const activeUrl = active.chunk?.metadata?.url as string | undefined;
  const activeHost = getHost(activeUrl);
  const activeIsFile = isFileSource(activeUrl);

  const goPrev = () =>
    setActiveIdx((i) => (i - 1 + group.length) % group.length);
  const goNext = () => setActiveIdx((i) => (i + 1) % group.length);

  return (
    <span
      ref={wrapperRef}
      className="relative inline-block align-middle not-prose"
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setActiveIdx(0);
          setOpen((o) => !o);
        }}
        className="inline-flex items-center gap-1 h-[19px] px-1.5 mx-0.5 -translate-y-[1px] rounded-full bg-light-200/70 dark:bg-dark-200/70 hover:bg-light-200 dark:hover:bg-dark-200 text-[11px] font-medium text-black/70 dark:text-white/70 align-middle transition-colors duration-150 no-underline cursor-pointer"
      >
        {primaryHost && (
          <img
            src={faviconUrl(primaryHost)}
            alt=""
            className="w-3 h-3 rounded-sm flex-shrink-0"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        )}
        <span className="truncate max-w-[7rem]">
          {getDomainLabel(primary.chunk?.metadata?.url)}
        </span>
        {group.length > 1 && (
          <span className="text-black/40 dark:text-white/40">
            +{group.length - 1}
          </span>
        )}
      </button>

      {open && (
        <div
          onMouseEnter={openNow}
          onMouseLeave={scheduleClose}
          className="absolute z-40 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 max-w-[80vw] rounded-lg border border-light-200 dark:border-dark-200 bg-light-primary dark:bg-dark-primary shadow-xl p-3 text-left"
        >
          <div className="flex items-center gap-2 mb-1.5">
            {activeHost && (
              <img
                src={faviconUrl(activeHost)}
                alt=""
                className="w-4 h-4 rounded-sm flex-shrink-0"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            )}
            <span className="text-xs font-medium text-black/60 dark:text-white/60 truncate">
              {getDomainLabel(activeUrl)}
            </span>
          </div>

          <p className="text-sm font-medium text-black dark:text-white line-clamp-2 mb-1">
            {active.chunk?.metadata?.title || 'Untitled source'}
          </p>

          {active.chunk?.content && (
            <p className="text-xs text-black/60 dark:text-white/60 line-clamp-2">
              {active.chunk.content}
            </p>
          )}

          <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-light-200 dark:border-dark-200">
            {group.length > 1 ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={goPrev}
                  aria-label="Previous source"
                  className="p-0.5 rounded hover:bg-light-secondary dark:hover:bg-dark-secondary text-black/50 dark:text-white/50"
                >
                  <ChevronLeft size={12} />
                </button>
                <span className="text-[11px] text-black/50 dark:text-white/50 tabular-nums">
                  {activeIdx + 1}/{group.length}
                </span>
                <button
                  type="button"
                  onClick={goNext}
                  aria-label="Next source"
                  className="p-0.5 rounded hover:bg-light-secondary dark:hover:bg-dark-secondary text-black/50 dark:text-white/50"
                >
                  <ChevronRight size={12} />
                </button>
              </div>
            ) : (
              <span />
            )}

            {!activeIsFile && activeUrl && (
              <a
                href={activeUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[11px] text-sky-500 hover:text-sky-400 font-medium"
              >
                Visit <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>
      )}
    </span>
  );
};

export default Citation;
