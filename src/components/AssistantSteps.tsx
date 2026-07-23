'use client';

import {
  ChevronRight,
  Sparkles,
  Search,
  Globe,
  BookSearch,
  FileText,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Chunk, ResearchBlock, ResearchBlockSubStep } from '@/lib/types';
import { useChat } from '@/lib/hooks/useChat';

const pluralize = (count: number, singular: string) =>
  count === 1 ? singular : `${singular}s`;

const getHost = (url?: string) => {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

const faviconUrl = (host: string) =>
  `https://s2.googleusercontent.com/s2/favicons?domain=${host}&sz=32`;

/* One-line gerund status shown under the collapsed header while research is
   still running -- always reflects whatever the *latest* subStep is doing. */
const getCurrentStepLabel = (step: ResearchBlockSubStep): string => {
  switch (step.type) {
    case 'reasoning':
      return step.reasoning || 'Thinking';
    case 'searching':
      return 'Searching the web';
    case 'search_results':
      return 'Reviewing search results';
    case 'reading':
      return 'Reading sources';
    case 'upload_searching':
      return 'Searching your files';
    case 'upload_search_results':
      return 'Reading your files';
    default:
      return 'Researching';
  }
};

/* Icon + label shown per row in the expanded step list. */
const getStepIcon = (step: ResearchBlockSubStep) => {
  switch (step.type) {
    case 'reasoning':
      return <Sparkles className="w-3.5 h-3.5" />;
    case 'searching':
    case 'upload_searching':
      return <Search className="w-3.5 h-3.5" />;
    case 'search_results':
      return <Globe className="w-3.5 h-3.5" />;
    case 'reading':
      return <BookSearch className="w-3.5 h-3.5" />;
    case 'upload_search_results':
      return <FileText className="w-3.5 h-3.5" />;
    default:
      return null;
  }
};

const getStepLabel = (step: ResearchBlockSubStep): string => {
  switch (step.type) {
    case 'reasoning':
      return step.reasoning || 'Thinking';
    case 'searching':
      return 'Searching';
    case 'search_results':
      return `Found ${step.reading.length} ${pluralize(step.reading.length, 'result')}`;
    case 'reading':
      return 'Reading';
    case 'upload_searching':
      return 'Searching your files';
    case 'upload_search_results':
      return `Found ${step.results.length} ${pluralize(step.results.length, 'passage')}`;
    default:
      return 'Researching';
  }
};

/* Exact search queries as verbatim chips -- the owner explicitly wants the
   real query text visible, not a paraphrase. */
const QueryChips = ({ queries }: { queries: string[] }) => (
  <div className="flex flex-wrap gap-1.5 mt-1.5">
    {queries.map((query, idx) => (
      <span
        key={idx}
        className="inline-flex items-center px-2 py-1 rounded-md text-[11px] font-mono bg-light-100 dark:bg-dark-100 text-black/70 dark:text-white/70 border border-light-200 dark:border-dark-200"
      >
        {query}
      </span>
    ))}
  </div>
);

/* Compact favicon row for search_results -- capped so a large result set
   doesn't turn into a wall of icons. */
const FaviconRow = ({ chunks }: { chunks: Chunk[] }) => {
  const withHost = chunks
    .map((chunk) => ({ chunk, host: getHost(chunk.metadata?.url) }))
    .filter((entry) => entry.host);

  const visible = withHost.slice(0, 8);
  const remaining = withHost.length - visible.length;

  if (visible.length === 0) return null;

  return (
    <div className="flex items-center gap-1 mt-1.5">
      {visible.map(({ chunk, host }, idx) => (
        <a
          key={idx}
          href={chunk.metadata.url}
          target="_blank"
          rel="noreferrer"
          title={chunk.metadata.title || host}
          className="w-5 h-5 rounded-full bg-light-100 dark:bg-dark-100 border border-light-200 dark:border-dark-200 flex items-center justify-center overflow-hidden hover:scale-110 transition-transform duration-150"
        >
          <img
            src={faviconUrl(host)}
            alt=""
            className="w-3.5 h-3.5"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        </a>
      ))}
      {remaining > 0 && (
        <span className="text-[11px] text-black/50 dark:text-white/50 ml-0.5">
          +{remaining} more
        </span>
      )}
    </div>
  );
};

/* Favicon + title rows for reading (quality mode scrapes) -- one line per
   page, unlike the compact icon-only row used for search_results. */
const ReadingList = ({ chunks }: { chunks: Chunk[] }) => (
  <div className="mt-1.5 space-y-1">
    {chunks.map((chunk, idx) => {
      const host = getHost(chunk.metadata?.url);
      const title = chunk.metadata?.title || host || 'Untitled';

      return (
        <a
          key={idx}
          href={chunk.metadata?.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-xs text-black/70 dark:text-white/70 hover:text-teal-600 dark:hover:text-teal-400 transition-colors duration-150"
        >
          {host && (
            <img
              src={faviconUrl(host)}
              alt=""
              className="w-3.5 h-3.5 rounded-sm flex-shrink-0"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
          <span className="line-clamp-1">{title}</span>
        </a>
      );
    })}
  </div>
);

/* Uploaded-file passages have no favicon, just a title. */
const PassageList = ({ chunks }: { chunks: Chunk[] }) => (
  <div className="mt-1.5 space-y-1">
    {chunks.map((chunk, idx) => (
      <div
        key={idx}
        className="flex items-center gap-2 text-xs text-black/70 dark:text-white/70"
      >
        <FileText className="w-3.5 h-3.5 flex-shrink-0 text-black/40 dark:text-white/40" />
        <span className="line-clamp-1">
          {chunk.metadata?.title || chunk.metadata?.fileName || 'Untitled document'}
        </span>
      </div>
    ))}
  </div>
);

const AssistantSteps = ({
  block,
  status,
  isLast,
}: {
  block: ResearchBlock;
  status: 'answering' | 'completed' | 'error';
  isLast: boolean;
}) => {
  /* Perplexity-style default: collapsed, whether research is running or
     already done. The user has to click to see the full step list -- we
     never auto-expand or force-collapse out from under them. */
  const [isExpanded, setIsExpanded] = useState(false);
  const { researchEnded } = useChat();

  if (!block || block.data.subSteps.length === 0) return null;

  const subSteps = block.data.subSteps;
  const stepCount = subSteps.length;
  const isRunning = isLast && status === 'answering' && !researchEnded;
  const lastStep = subSteps[stepCount - 1];

  const headerLabel = isRunning
    ? `Working · ${stepCount} ${pluralize(stepCount, 'step')} completed`
    : `Completed · ${stepCount} ${pluralize(stepCount, 'step')}`;

  return (
    <div className="rounded-lg bg-light-secondary dark:bg-dark-secondary border border-light-200 dark:border-dark-200 overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-light-200 dark:hover:bg-dark-200 transition duration-200"
      >
        <div className="flex items-center gap-2">
          {isRunning ? (
            <span className="relative flex h-2 w-2 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-500" />
            </span>
          ) : (
            <Sparkles className="w-4 h-4 text-black/40 dark:text-white/40" />
          )}
          <span className="text-sm font-medium text-black dark:text-white">
            {headerLabel}
          </span>
        </div>
        <ChevronRight
          className={`w-4 h-4 text-black/50 dark:text-white/50 transition-transform duration-200 ${
            isExpanded ? 'rotate-90' : ''
          }`}
        />
      </button>

      {!isExpanded && isRunning && lastStep && (
        <div className="px-3 pb-3 -mt-1 flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 flex-shrink-0 text-teal-600 dark:text-teal-400 animate-pulse" />
          <span className="text-sm text-teal-600 dark:text-teal-400 animate-pulse line-clamp-1">
            {getCurrentStepLabel(lastStep)}
          </span>
        </div>
      )}

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-light-200 dark:border-dark-200"
          >
            <div className="p-3 space-y-0">
              {subSteps.map((step, index) => {
                const isLastStep = index === stepCount - 1;
                const isStreamingStep = isRunning && isLastStep;

                return (
                  <motion.div
                    key={step.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2, delay: 0 }}
                    className="flex gap-2.5"
                  >
                    <div className="flex flex-col items-center -mt-0.5">
                      <div
                        className={`rounded-full p-1.5 bg-light-100 dark:bg-dark-100 ${
                          isStreamingStep
                            ? 'text-teal-600 dark:text-teal-400 animate-pulse'
                            : 'text-black/50 dark:text-white/50'
                        }`}
                      >
                        {getStepIcon(step)}
                      </div>
                      {!isLastStep && (
                        <div className="w-0.5 flex-1 min-h-[20px] bg-light-200 dark:bg-dark-200 mt-1.5" />
                      )}
                    </div>

                    <div className="flex-1 pb-3 min-w-0">
                      {step.type === 'reasoning' ? (
                        <p
                          className={`text-sm ${
                            isStreamingStep
                              ? 'text-teal-600 dark:text-teal-400'
                              : 'text-black/80 dark:text-white/80'
                          }`}
                        >
                          {getStepLabel(step)}
                        </p>
                      ) : (
                        <span className="text-sm font-medium text-black/80 dark:text-white/80">
                          {getStepLabel(step)}
                        </span>
                      )}

                      {step.type === 'searching' && (
                        <QueryChips queries={step.searching} />
                      )}
                      {step.type === 'upload_searching' && (
                        <QueryChips queries={step.queries} />
                      )}
                      {step.type === 'search_results' && (
                        <FaviconRow chunks={step.reading} />
                      )}
                      {step.type === 'reading' && (
                        <ReadingList chunks={step.reading} />
                      )}
                      {step.type === 'upload_search_results' && (
                        <PassageList chunks={step.results} />
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AssistantSteps;
