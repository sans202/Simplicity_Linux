import { useChat } from '@/lib/hooks/useChat';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { CaretDownIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { Check, Scale, Telescope } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { MinimalProvider } from '@/lib/models/types';
import { canRunCouncil } from '@/lib/agents/council/select';

/* Perplexity ground truth (2026-07): this dropdown hangs off the Search
   pill itself, and lists exactly two options — Search and Deep research.
   Picking one just swaps the pill's icon/label; the actual behaviour switch
   is `searchMode` in useChat, threaded to the server as-is.

   Model council (SPEC 2) is added as a third entry in that same list rather
   than a separate composer flag — it's just another value of `searchMode`,
   reusing every bit of that existing plumbing end-to-end. */

const modeList = [
  {
    key: 'search' as const,
    name: 'Search',
    description: 'Fast answers with sources',
    icon: <MagnifyingGlassIcon className="h-[16px] w-auto" />,
  },
  {
    key: 'deepResearch' as const,
    name: 'Deep research',
    description: 'In-depth report, takes a few minutes',
    icon: <Telescope className="h-[16px] w-auto" />,
  },
  {
    key: 'council' as const,
    name: 'Model council',
    description: 'Up to 3 models answer in parallel, a chair compares them',
    icon: <Scale className="h-[16px] w-auto" />,
  },
];

const ModeSelector = () => {
  const { searchMode, setSearchMode } = useChat();
  const [providers, setProviders] = useState<MinimalProvider[]>([]);

  /* Own fetch, mirroring ChatModelSelector's pattern — this component has no
     other reason to depend on the composer's model-picker state, and the
     gate below only needs a read of what's connected. */
  useEffect(() => {
    let cancelled = false;

    const loadProviders = async () => {
      try {
        const res = await fetch('/api/providers');
        if (!res.ok) return;
        const data: { providers: MinimalProvider[] } = await res.json();
        if (!cancelled) setProviders(data.providers);
      } catch {
        /* Leave providers empty — council just stays disabled, same as a
           genuinely disconnected setup. */
      }
    };

    loadProviders();
    return () => {
      cancelled = true;
    };
  }, []);

  const current = modeList.find((m) => m.key === searchMode) ?? modeList[0];

  /* Hard gate (SPEC 2 §2/§9): a real disable at the entry point, not a
     submit-time error. The chat route re-checks this server-side too, as a
     defensive backstop for a stale client. */
  const councilAvailable = canRunCouncil(providers);

  return (
    <Popover className="relative">
      {({ open }) => (
        <>
          {/* Labelled the same way as Sources and the model button — the
              label doubles as the current state. */}
          <PopoverButton className="flex flex-row items-center gap-1.5 active:border-none hover:bg-light-200 hover:dark:bg-dark-200 px-2 py-1.5 rounded-lg focus:outline-none text-black/50 dark:text-white/50 active:scale-95 transition duration-200 hover:text-black dark:hover:text-white">
            <span className="shrink-0">{current.icon}</span>
            <span className="text-xs font-medium max-w-[110px] truncate">
              {current.name}
            </span>
            <CaretDownIcon className="h-[12px] w-auto shrink-0 opacity-60" />
          </PopoverButton>
          <AnimatePresence>
            {open && (
              <PopoverPanel
                static
                className="absolute z-10 w-64 md:w-[240px] right-0"
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.1, ease: 'easeOut' }}
                  className="origin-top-right flex flex-col bg-light-primary dark:bg-dark-primary border rounded-lg border-light-200 dark:border-dark-200 w-full p-1 shadow-lg"
                >
                  {modeList.map((m) => {
                    const disabled = m.key === 'council' && !councilAvailable;

                    return (
                      <div
                        key={m.key}
                        title={
                          disabled
                            ? 'Connect at least 2 models to use Model council'
                            : undefined
                        }
                        className={
                          disabled
                            ? 'flex flex-row items-start justify-between gap-2 rounded-md py-2.5 px-2 opacity-40 cursor-not-allowed'
                            : 'flex flex-row items-start justify-between gap-2 hover:bg-light-100 hover:dark:bg-dark-100 rounded-md py-2.5 px-2 cursor-pointer'
                        }
                        onClick={() => !disabled && setSearchMode(m.key)}
                      >
                        <div className="flex flex-row space-x-2 text-black/80 dark:text-white/80">
                          <div className="pt-0.5 shrink-0">{m.icon}</div>
                          <div>
                            <p className="text-xs font-medium">{m.name}</p>
                            <p className="text-[11px] text-black/50 dark:text-white/50">
                              {m.description}
                            </p>
                          </div>
                        </div>
                        {searchMode === m.key && (
                          <Check
                            size={14}
                            className="shrink-0 mt-0.5 text-black dark:text-white"
                          />
                        )}
                      </div>
                    );
                  })}
                </motion.div>
              </PopoverPanel>
            )}
          </AnimatePresence>
        </>
      )}
    </Popover>
  );
};

export default ModeSelector;
