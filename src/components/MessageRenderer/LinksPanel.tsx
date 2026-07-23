'use client';

/* eslint-disable @next/next/no-img-element */
import { File } from 'lucide-react';
import { Chunk } from '@/lib/types';
import { faviconUrl, getDomainLabel, getHost, isFileSource } from './sourceUtils';

/** Full source cards for the "Links" tab: favicon, domain, title, snippet. */
const LinksPanel = ({ sources }: { sources: Chunk[] }) => {
  if (sources.length === 0) {
    return (
      <p className="text-sm text-black/50 dark:text-white/50 py-6 text-center">
        No sources for this answer.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {sources.map((source, i) => {
        const url = source.metadata?.url as string | undefined;
        const isFile = isFileSource(url);
        const host = getHost(url);

        const Card = (
          <div className="h-full bg-light-secondary hover:bg-light-200 dark:bg-dark-secondary dark:hover:bg-dark-200 border border-light-200 dark:border-dark-200 transition duration-200 rounded-lg p-3 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              {isFile ? (
                <div className="bg-dark-200 flex items-center justify-center w-4 h-4 rounded-full flex-shrink-0">
                  <File size={10} className="text-white/70" />
                </div>
              ) : (
                host && (
                  <img
                    src={faviconUrl(host)}
                    width={14}
                    height={14}
                    alt=""
                    className="rounded-sm h-3.5 w-3.5 flex-shrink-0"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )
              )}
              <span className="text-xs text-black/50 dark:text-white/50 truncate">
                {getDomainLabel(url)}
              </span>
              <span className="ml-auto text-[11px] text-black/40 dark:text-white/40 flex-shrink-0">
                {i + 1}
              </span>
            </div>
            <p className="text-sm font-medium text-black dark:text-white line-clamp-2">
              {source.metadata?.title || getDomainLabel(url)}
            </p>
            {source.content && (
              <p className="text-xs text-black/60 dark:text-white/60 line-clamp-2">
                {source.content}
              </p>
            )}
          </div>
        );

        return isFile ? (
          <div key={i}>{Card}</div>
        ) : (
          <a key={i} href={url} target="_blank" rel="noreferrer">
            {Card}
          </a>
        );
      })}
    </div>
  );
};

export default LinksPanel;
