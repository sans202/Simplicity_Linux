import { describe, expect, it } from 'vitest';
import {
  MAX_COUNCIL_MEMBERS,
  MIN_COUNCIL_MEMBERS,
  autoPickCouncil,
  canRunCouncil,
  estimateCouncilCost,
  pickChair,
} from './select';
import { MinimalProvider } from '@/lib/models/types';

/* Pins the member/chair auto-selection contract (SPEC 2 §3): auto-pick
 * returns at most 3 rows, one per distinct vendor, in the same quality order
 * "Best" uses (BEST_ORDER); the chair defaults to "Best-resolved" and always
 * falls back to something usable; the hard 2-usable-row gate is checked
 * against what auto-pick can actually produce, not the raw row count. */

const provider = (
  id: string,
  type: string,
  chatKeys: string[],
): MinimalProvider => ({
  id,
  type,
  name: id,
  chatModels: chatKeys.map((key) => ({ key, name: key })),
  embeddingModels: [],
});

describe('autoPickCouncil', () => {
  it('picks up to 3 distinct-vendor rows', () => {
    const providers: MinimalProvider[] = [
      provider('p-openai', 'openai', ['gpt-5.1']),
      provider('p-anthropic', 'anthropic', ['claude-sonnet-5']),
      provider('p-gemini', 'gemini', ['models/gemini-2.5-pro']),
      provider('p-xai', 'xai', ['grok-4']),
    ];

    const picked = autoPickCouncil(providers);

    expect(picked.length).toBe(MAX_COUNCIL_MEMBERS);
    const vendors = new Set(
      picked.map((r) => providers.find((p) => p.id === r.providerId)?.type),
    );
    expect(vendors.size).toBe(picked.length);
  });

  it('orders picks by BEST_ORDER preference — claudecode before anthropic before gemini', () => {
    const providers: MinimalProvider[] = [
      provider('p-gemini', 'gemini', ['models/gemini-2.5-pro']),
      provider('p-claudecode', 'claudecode', ['sonnet', 'opus']),
      provider('p-anthropic', 'anthropic', ['claude-sonnet-5']),
    ];

    const picked = autoPickCouncil(providers);

    /* claudecode/sonnet ranks first in BEST_ORDER; anthropic's row (Claude
       Sonnet 5) resolves through claudecode FIRST (catalog.ts candidate
       order), so anthropic never even surfaces as a distinct vendor here —
       gemini should be the second pick. */
    expect(picked[0].providerId).toBe('p-claudecode');
    expect(picked[1].providerId).toBe('p-gemini');
  });

  it('dedupes same-vendor rows down to one pick', () => {
    const providers: MinimalProvider[] = [
      provider('p-openai', 'openai', ['gpt-5.1', 'gpt-5-mini']),
    ];

    const picked = autoPickCouncil(providers);

    expect(picked.length).toBe(1);
  });

  it('returns fewer than 3 when fewer than 3 distinct vendors are connected', () => {
    const providers: MinimalProvider[] = [
      provider('p-openai', 'openai', ['gpt-5.1']),
      provider('p-xai', 'xai', ['grok-4']),
    ];

    const picked = autoPickCouncil(providers);

    expect(picked.length).toBe(2);
  });

  it('returns an empty list when nothing is connected', () => {
    expect(autoPickCouncil([])).toEqual([]);
  });

  it('ranks a row absent from BEST_ORDER (e.g. GPT-OSS 20B) after ranked rows', () => {
    const providers: MinimalProvider[] = [
      provider('p-groq', 'groq', ['openai/gpt-oss-20b']),
      provider('p-openai', 'openai', ['gpt-5.1']),
    ];

    const picked = autoPickCouncil(providers);

    expect(picked[0].providerId).toBe('p-openai');
    expect(picked[1].providerId).toBe('p-groq');
  });
});

describe('canRunCouncil', () => {
  it('is true with 2+ distinct-vendor rows connected', () => {
    const providers: MinimalProvider[] = [
      provider('p-openai', 'openai', ['gpt-5.1']),
      provider('p-xai', 'xai', ['grok-4']),
    ];
    expect(canRunCouncil(providers)).toBe(true);
  });

  it('is false with only one connected row', () => {
    const providers: MinimalProvider[] = [provider('p-openai', 'openai', ['gpt-5.1'])];
    expect(canRunCouncil(providers)).toBe(false);
  });

  it('is false with nothing connected', () => {
    expect(canRunCouncil([])).toBe(false);
  });

  it('is false when 2 rows are connected but both resolve to the same vendor', () => {
    /* The naive "availableRows().length >= 2" check would wrongly pass this
       case; auto-pick can only ever produce 1 member from it. */
    const providers: MinimalProvider[] = [
      provider('p-openai', 'openai', ['gpt-5.1', 'gpt-5-mini']),
    ];
    expect(canRunCouncil(providers)).toBe(false);
    expect(autoPickCouncil(providers).length).toBeLessThan(MIN_COUNCIL_MEMBERS);
  });
});

describe('pickChair', () => {
  it('defaults to the Best-resolved model', () => {
    const providers: MinimalProvider[] = [
      provider('p-openai', 'openai', ['gpt-5.1']),
      provider('p-claudecode', 'claudecode', ['sonnet']),
    ];

    /* claudecode/sonnet is BEST_ORDER's #1 preference. */
    expect(pickChair(providers)).toEqual({ providerId: 'p-claudecode', key: 'sonnet' });
  });

  it("falls back to auto-pick's top choice when nothing in BEST_ORDER resolves", () => {
    const providers: MinimalProvider[] = [
      provider('p-openai', 'openai', ['gpt-5-mini']),
      provider('p-groq', 'groq', ['openai/gpt-oss-20b']),
    ];

    /* Neither GPT-5 mini nor GPT-OSS 20B appears in BEST_ORDER at all, so
       resolveBest finds nothing — pickChair must still return SOMETHING
       usable rather than null, and it should be auto-pick's own top choice
       (GPT-5 mini, since CATALOG_ROWS lists it before GPT-OSS 20B and
       neither outranks the other via BEST_ORDER). */
    expect(pickChair(providers)).toEqual({ providerId: 'p-openai', key: 'gpt-5-mini' });
  });

  it('returns null when nothing is connected', () => {
    expect(pickChair([])).toBeNull();
  });
});

describe('estimateCouncilCost', () => {
  it('marks the whole estimate free when every member and the chair are free providers', () => {
    const estimate = estimateCouncilCost(
      'a short shared prompt',
      [
        { rowId: 'a', providerType: 'ollama', key: 'qwen2.5:7b' },
        { rowId: 'b', providerType: 'claudecode', key: 'sonnet' },
      ],
      { providerType: 'claudecode', key: 'opus' },
    );

    expect(estimate.free).toBe(true);
    expect(estimate.totalUSD).toBeNull();
    expect(estimate.perMember.every((m) => m.free)).toBe(true);
  });

  it('computes a positive USD total when at least one priced model is involved', () => {
    const estimate = estimateCouncilCost(
      'a short shared prompt',
      [{ rowId: 'a', providerType: 'openai', key: 'gpt-5.1' }],
      { providerType: 'ollama', key: 'qwen2.5:7b' },
    );

    expect(estimate.free).toBe(false);
    expect(estimate.totalUSD).not.toBeNull();
    expect(estimate.totalUSD as number).toBeGreaterThan(0);
    expect(estimate.perMember[0].free).toBe(false);
  });
});
