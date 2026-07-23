'use client';

import { useState } from 'react';
import Markdown from 'markdown-to-jsx';
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Loader2,
  Scale,
  StopCircle,
  X,
} from 'lucide-react';
import { CouncilBlock as CouncilBlockType, CouncilMember } from '@/lib/types';
import { cn } from '@/lib/utils';
import ProviderLogo from '../ui/ProviderLogo';

/* Model Council's own card (SPEC 2 §8). Deliberately does NOT re-render the
   chair's verdict as markdown here — that text streams into a normal 'text'
   block instead (see CouncilAgent) so it renders through the existing
   Markdown + citation pipeline in MessageBox for free. This component only
   owns the supporting comparison surface: per-member status chips and
   expandable answer cards, plus the chair's status/name. */

/* Small local duplicate of UsageLine's cost formatting -- not imported since
   UsageLine.tsx doesn't export it (and is off-limits to modify). Never shows
   a raw float like $0.00417382. */
const formatCost = (n: number): string => {
  if (n <= 0) return '$0.00';
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
};

const StatusIcon = ({ status }: { status: CouncilMember['status'] }) => {
  switch (status) {
    case 'pending':
      return <CircleDashed size={13} className="text-black/30 dark:text-white/30 shrink-0" />;
    case 'streaming':
      return <Loader2 size={13} className="animate-spin text-sky-500 shrink-0" />;
    case 'done':
      return <Check size={13} className="text-emerald-500 shrink-0" />;
    case 'error':
      return <X size={13} className="text-red-500 shrink-0" />;
    case 'cancelled':
      return <StopCircle size={13} className="text-black/40 dark:text-white/40 shrink-0" />;
  }
};

const MemberCard = ({ member }: { member: CouncilMember }) => {
  const [open, setOpen] = useState(false);
  const hasAnswer = member.answer.trim().length > 0;

  return (
    <div className="rounded-lg border border-light-200 dark:border-dark-200 overflow-hidden bg-light-primary dark:bg-dark-primary">
      <button
        type="button"
        onClick={() => hasAnswer && setOpen((o) => !o)}
        className={cn(
          'w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors duration-200',
          hasAnswer && 'hover:bg-light-secondary dark:hover:bg-dark-secondary cursor-pointer',
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <ProviderLogo
            providerKey={member.providerType}
            size={14}
            className="text-black/60 dark:text-white/60 shrink-0"
          />
          <span className="text-xs font-medium text-black/80 dark:text-white/80 truncate">
            {member.name}
          </span>
          <StatusIcon status={member.status} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {member.status === 'done' && (
            <span className="text-[11px] text-black/40 dark:text-white/40 tabular-nums">
              {member.free ? 'Free' : member.cost != null ? formatCost(member.cost) : ''}
            </span>
          )}
          {hasAnswer && (open ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
        </div>
      </button>

      {member.status === 'error' && member.error && (
        <div className="px-3 pb-2 -mt-0.5 text-[11px] text-red-500/80">{member.error}</div>
      )}
      {member.status === 'cancelled' && (
        <div className="px-3 pb-2 -mt-0.5 text-[11px] text-black/40 dark:text-white/40">
          Stopped
        </div>
      )}

      {open && hasAnswer && (
        <div className="border-t border-light-200 dark:border-dark-200 px-3 py-2.5 text-xs text-black/70 dark:text-white/70 max-h-64 overflow-y-auto">
          <Markdown className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5">
            {member.answer}
          </Markdown>
        </div>
      )}
    </div>
  );
};

const CouncilBlockRenderer = ({ block }: { block: CouncilBlockType }) => {
  const {
    members,
    chairName,
    chairStatus,
    chairSkippedReason,
    chairProviderType,
    costEstimate,
  } = block.data;

  const stillRunning =
    members.some((m) => m.status === 'pending' || m.status === 'streaming') ||
    chairStatus === 'pending' ||
    chairStatus === 'streaming';

  return (
    <div className="rounded-lg bg-light-secondary dark:bg-dark-secondary border border-light-200 dark:border-dark-200 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-black/70 dark:text-white/70">
          <Scale size={14} />
          <span>
            Model council · {members.length} {members.length === 1 ? 'model' : 'models'}
          </span>
        </div>

        {stillRunning && costEstimate && (
          <span className="text-[11px] text-black/40 dark:text-white/40 tabular-nums">
            {costEstimate.free
              ? 'Free'
              : `~${formatCost(costEstimate.totalUSD ?? 0)} est.`}
          </span>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {members.map((member) => (
          <MemberCard key={member.rowId} member={member} />
        ))}
      </div>

      <div className="flex items-center gap-1.5 pt-2 border-t border-light-200 dark:border-dark-200 text-xs">
        <ProviderLogo
          providerKey={chairProviderType ?? 'openai'}
          size={13}
          className="text-black/50 dark:text-white/50 shrink-0"
        />
        <span className="text-black/60 dark:text-white/60">
          Chair: <span className="font-medium text-black/80 dark:text-white/80">{chairName}</span>
        </span>
        {chairStatus === 'streaming' && (
          <Loader2 size={12} className="animate-spin text-sky-500 shrink-0" />
        )}
        {chairStatus === 'done' && <Check size={12} className="text-emerald-500 shrink-0" />}
        {(chairStatus === 'skipped' || chairStatus === 'error') && chairSkippedReason && (
          <span className="text-black/40 dark:text-white/40 truncate">
            · {chairSkippedReason}
          </span>
        )}
      </div>
    </div>
  );
};

export default CouncilBlockRenderer;
