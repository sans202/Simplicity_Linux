import { beforeEach, describe, expect, it, vi } from 'vitest';

/* The regression suite for the deterministic researcher.
 *
 * The defining scenario: a provider that can never emit tool calls (the
 * Claude Code CLI, any text-only model) used to silently return zero sources,
 * because retrieval lived inside a model tool-call loop. These tests pin the
 * new contract: once research starts, sources come back — regardless of what
 * the model can or cannot do. */

const searchMock = vi.fn();
const scraperMock = vi.fn();

vi.mock('@/lib/searxng', () => ({
  searchSearxng: (...args: any[]) => searchMock(...args),
}));

/* Deep Research's quality-mode passes scrape real pages via Playwright.
   None of that belongs in a unit test — stub it out with instant dummy
   content so the quality rounds exercise the picker/extractor code paths
   without ever touching a browser or the network. */
vi.mock('@/lib/scraper', () => ({
  default: {
    scrape: (...args: any[]) => scraperMock(...args),
  },
}));

import Researcher from './index';
import SessionManager from '@/lib/session';
import BaseLLM from '@/lib/models/base/llm';
import BaseEmbedding from '@/lib/models/base/embedding';
import { ClassifierOutput, SearchAgentConfig } from '../types';

/* A provider that answers in text and structured output but has NO tool-call
   support at all — the exact shape of the Claude Code CLI provider. */
class TextOnlyLLM extends BaseLLM<any> {
  constructor(private objectResponses: any[]) {
    super({});
  }
  async generateText(): Promise<any> {
    return { content: 'text', toolCalls: [] };
  }
  async *streamText(): AsyncGenerator<any> {
    yield { contentChunk: 'text', toolCallChunk: [], done: true };
  }
  async generateObject<T>(): Promise<any> {
    if (this.objectResponses.length === 0) {
      throw new Error('generateObject failure (simulated)');
    }
    return this.objectResponses.shift();
  }
  async *streamObject<T>(): AsyncGenerator<any> {
    yield {};
  }
}

class FakeEmbedding extends BaseEmbedding<any> {
  async embedText(texts: string[]): Promise<number[][]> {
    return texts.map(() => [1, 0]);
  }
  async embedChunks(chunks: any[]): Promise<number[][]> {
    return chunks.map(() => [1, 0]);
  }
}

const classification = (over: Partial<ClassifierOutput['classification']> = {}) =>
  ({
    classification: {
      skipSearch: false,
      personalSearch: false,
      academicSearch: false,
      discussionSearch: false,
      showWeatherWidget: false,
      showStockWidget: false,
      showCalculationWidget: false,
      ...over,
    },
    standaloneFollowUp: 'Who is Mann Bellani?',
  }) as ClassifierOutput;

const makeConfig = (
  llm: BaseLLM<any>,
  over: Partial<SearchAgentConfig> = {},
): SearchAgentConfig => ({
  sources: ['web'],
  fileIds: [],
  llm,
  embedding: new FakeEmbedding({}) as any,
  mode: 'speed',
  systemInstructions: '',
  ...over,
});

const searxngPage = (n: number) => ({
  results: Array.from({ length: n }, (_, i) => ({
    title: `Result ${i}`,
    url: `https://example.com/${i}`,
    content: `Content about the query, item ${i}`,
  })),
  suggestions: [],
});

/* A provider that, on the first structured-output call, plans the initial
   queries — and on every call after that, claims the round wasn't
   sufficient and hands back fresh, never-before-seen queries. It never
   naturally terminates the research loop; only the hard caps in Researcher
   are allowed to do that. It also stands in for the picker/extractor calls
   that Deep Research's quality-mode passes make (they get a wrong-shaped
   response, which both call sites already handle by falling back
   gracefully). */
class NeverSufficientLLM extends BaseLLM<any> {
  private call = 0;
  constructor() {
    super({});
  }
  async generateText(): Promise<any> {
    return { content: 'text', toolCalls: [] };
  }
  async *streamText(): AsyncGenerator<any> {
    yield { contentChunk: 'text', toolCallChunk: [], done: true };
  }
  async generateObject<T>(): Promise<any> {
    this.call += 1;
    if (this.call === 1) {
      return {
        plan: 'Researching deeply',
        queries: ['deep query a', 'deep query b', 'deep query c'],
      };
    }
    return {
      sufficient: false,
      plan: `Digging deeper (${this.call})`,
      queries: [`q${this.call}-a`, `q${this.call}-b`, `q${this.call}-c`],
    };
  }
  async *streamObject<T>(): AsyncGenerator<any> {
    yield {};
  }
}

beforeEach(() => {
  searchMock.mockReset();
  scraperMock.mockReset();
  scraperMock.mockResolvedValue({
    content: 'Scraped page body with some facts in it.',
    title: 'Scraped title',
  });
});

describe('deterministic researcher', () => {
  it('returns sources from a provider with zero tool-call support', async () => {
    searchMock.mockResolvedValue(searxngPage(5));

    const llm = new TextOnlyLLM([
      { plan: 'Researching Mann Bellani', queries: ['mann bellani', 'mann bellani texas a&m'] },
    ]);

    const researcher = new Researcher();
    const out = await researcher.research(SessionManager.createSession(), {
      chatHistory: [],
      followUp: 'Who is Mann Bellani?',
      classification: classification(),
      config: makeConfig(llm),
    });

    expect(searchMock).toHaveBeenCalled();
    expect(out.searchFindings.length).toBeGreaterThan(0);
  });

  it('still searches when every structured-output call fails', async () => {
    searchMock.mockResolvedValue(searxngPage(3));

    const llm = new TextOnlyLLM([]); // generateObject always throws

    const researcher = new Researcher();
    const out = await researcher.research(SessionManager.createSession(), {
      chatHistory: [],
      followUp: 'Who is Mann Bellani?',
      classification: classification(),
      config: makeConfig(llm),
    });

    /* Fallback plan = the standalone question verbatim. */
    expect(searchMock).toHaveBeenCalled();
    expect(searchMock.mock.calls[0][0]).toBe('Who is Mann Bellani?');
    expect(out.searchFindings.length).toBeGreaterThan(0);
  });

  it('survives one query failing out of several', async () => {
    searchMock
      .mockRejectedValueOnce(new Error('SearXNG search timed out'))
      .mockResolvedValue(searxngPage(4));

    const llm = new TextOnlyLLM([
      { plan: 'Researching', queries: ['failing query', 'working query'] },
    ]);

    const researcher = new Researcher();
    const out = await researcher.research(SessionManager.createSession(), {
      chatHistory: [],
      followUp: 'Who is Mann Bellani?',
      classification: classification(),
      config: makeConfig(llm),
    });

    expect(out.searchFindings.length).toBeGreaterThan(0);
  });

  it('runs the backstop query when planned queries return nothing', async () => {
    searchMock
      .mockResolvedValueOnce(searxngPage(0))
      .mockResolvedValueOnce(searxngPage(0))
      .mockResolvedValue(searxngPage(4));

    const llm = new TextOnlyLLM([
      { plan: 'Researching', queries: ['dead query one', 'dead query two'] },
    ]);

    const researcher = new Researcher();
    const out = await researcher.research(SessionManager.createSession(), {
      chatHistory: [],
      followUp: 'Who is Mann Bellani?',
      classification: classification(),
      config: makeConfig(llm),
    });

    const queriesRun = searchMock.mock.calls.map((c) => c[0]);
    expect(queriesRun).toContain('Who is Mann Bellani?');
    expect(out.searchFindings.length).toBeGreaterThan(0);
  });

  it('emits research and source blocks with populated substeps', async () => {
    searchMock.mockResolvedValue(searxngPage(5));

    const llm = new TextOnlyLLM([
      { plan: 'Researching Mann Bellani', queries: ['mann bellani'] },
    ]);

    const session = SessionManager.createSession();
    const researcher = new Researcher();
    await researcher.research(session, {
      chatHistory: [],
      followUp: 'Who is Mann Bellani?',
      classification: classification(),
      config: makeConfig(llm),
    });

    const blocks = session.getAllBlocks();
    const research = blocks.find((b) => b.type === 'research') as any;
    const source = blocks.find((b) => b.type === 'source') as any;

    expect(research).toBeDefined();
    expect(research.data.subSteps.length).toBeGreaterThan(0);
    expect(
      research.data.subSteps.some((s: any) => s.type === 'searching'),
    ).toBe(true);
    expect(source).toBeDefined();
    expect(source.data.length).toBeGreaterThan(0);
  });

  it('respects an already-aborted signal without searching', async () => {
    searchMock.mockResolvedValue(searxngPage(5));

    const llm = new TextOnlyLLM([
      { plan: 'Researching', queries: ['mann bellani'] },
    ]);

    const controller = new AbortController();
    controller.abort();

    const researcher = new Researcher();
    const out = await researcher.research(SessionManager.createSession(), {
      chatHistory: [],
      followUp: 'Who is Mann Bellani?',
      classification: classification(),
      config: makeConfig(llm, { signal: controller.signal }),
    });

    expect(searchMock).not.toHaveBeenCalled();
    expect(out.searchFindings.length).toBe(0);
  });
});

describe('deep research mode', () => {
  it('caps total SearxNG queries at 20 and completes even when refinement always demands more rounds', async () => {
    searchMock.mockResolvedValue(searxngPage(5));

    const llm = new NeverSufficientLLM();

    const researcher = new Researcher();
    const out = await researcher.research(SessionManager.createSession(), {
      chatHistory: [],
      followUp: 'Who is Mann Bellani?',
      classification: classification(),
      config: makeConfig(llm, { searchMode: 'deepResearch' }),
    });

    /* The deterministic guarantee, restated for Deep Research: refinement
       can claim "more rounds needed" forever, but the hard caps in code
       still bring the loop to an end. */
    expect(searchMock.mock.calls.length).toBeLessThanOrEqual(20);
    expect(out.searchFindings.length).toBeGreaterThan(0);
  }, 10000);

  it('respects an aborted signal between rounds instead of running all 6', async () => {
    const controller = new AbortController();
    let callCount = 0;

    searchMock.mockImplementation(async () => {
      callCount += 1;
      /* Abort partway through round one's fan-out — round one still
         finishes (the calls were already issued), but round two must never
         start. */
      if (callCount === 3) controller.abort();
      return searxngPage(5);
    });

    const llm = new NeverSufficientLLM();

    const researcher = new Researcher();
    const out = await researcher.research(SessionManager.createSession(), {
      chatHistory: [],
      followUp: 'Who is Mann Bellani?',
      classification: classification(),
      config: makeConfig(llm, {
        searchMode: 'deepResearch',
        signal: controller.signal,
      }),
    });

    /* Round one runs at most 3 breadth queries (single 'web' vertical, no
       quality pass on round one) — well short of the 20-query cap a full
       6-round run would otherwise reach. */
    expect(searchMock.mock.calls.length).toBeLessThanOrEqual(3);
    expect(out).toBeDefined();
  }, 10000);
});
