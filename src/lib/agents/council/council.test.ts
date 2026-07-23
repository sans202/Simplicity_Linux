import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Orchestration tests for CouncilAgent (SPEC 2 §4/§9): per-member isolation
 * (Promise.allSettled + try/catch — one member throwing must never kill the
 * others or the chair), the chair-degradation ladder (2+ successes -> chair
 * synthesizes; exactly 1 -> that answer stands alone; 0 -> a plain apology),
 * and abort handling. Follows the fake-LLM patterns in
 * researcher/researcher.test.ts.
 *
 * `writingMode: true` is used throughout to skip Researcher/search entirely
 * — that deterministic-retrieval path is already pinned by
 * researcher.test.ts, so these tests isolate what's actually new here: the
 * parallel member fan-out and the chair. classify() still runs
 * unconditionally (see CouncilAgent), so the fake chair/utility LLM below
 * always needs exactly one queued generateObject response for it. */

const dbRows = new Map<string, any>();

vi.mock('@/lib/db', () => {
  const where = () => ({ execute: vi.fn().mockResolvedValue(undefined) });

  return {
    default: {
      query: {
        messages: {
          findFirst: vi.fn(async () => undefined),
        },
      },
      insert: vi.fn(() => ({
        values: vi.fn(async (row: any) => {
          dbRows.set(row.messageId, row);
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((patch: any) => {
          const key = [...dbRows.keys()][0];
          if (key) dbRows.set(key, { ...dbRows.get(key), ...patch });
          return { where };
        }),
      })),
      delete: vi.fn(() => ({ where })),
    },
  };
});

import CouncilAgent from './index';
import SessionManager from '@/lib/session';
import BaseLLM from '@/lib/models/base/llm';
import BaseEmbedding from '@/lib/models/base/embedding';
import { CouncilAgentConfig, CouncilMemberSpec } from '../search/types';
import { CouncilBlock, TextBlock } from '@/lib/types';

class FakeEmbedding extends BaseEmbedding<any> {
  async embedText(texts: string[]): Promise<number[][]> {
    return texts.map(() => [1, 0]);
  }
  async embedChunks(chunks: any[]): Promise<number[][]> {
    return chunks.map(() => [1, 0]);
  }
}

const classifyResponse = {
  classification: {
    skipSearch: true,
    personalSearch: false,
    academicSearch: false,
    discussionSearch: false,
    showWeatherWidget: false,
    showStockWidget: false,
    showCalculationWidget: false,
  },
  standaloneFollowUp: 'What should the council answer?',
};

/* Doubles as the chair AND the utility model that backs classify() (no
   separate utilityLLM is configured, so CouncilAgent falls back to
   config.llm for it, same as SearchAgent). */
class FakeChairLLM extends BaseLLM<any> {
  constructor(private verdictChunks: string[]) {
    super({});
  }
  async generateText(): Promise<any> {
    return { content: '', toolCalls: [] };
  }
  async *streamText(): AsyncGenerator<any> {
    for (const chunk of this.verdictChunks) {
      yield { contentChunk: chunk, toolCallChunk: [] };
    }
    yield { contentChunk: '', toolCallChunk: [], done: true };
  }
  async generateObject<T>(): Promise<any> {
    return classifyResponse;
  }
  async *streamObject<T>(): AsyncGenerator<any> {
    yield {};
  }
}

class FakeMemberLLM extends BaseLLM<any> {
  constructor(
    private chunks: string[],
    private failWith?: string,
  ) {
    super({});
  }
  async generateText(): Promise<any> {
    return { content: '', toolCalls: [] };
  }
  async *streamText(): AsyncGenerator<any> {
    for (const chunk of this.chunks) {
      yield { contentChunk: chunk, toolCallChunk: [] };
    }
    if (this.failWith) throw new Error(this.failWith);
    yield { contentChunk: '', toolCallChunk: [], done: true };
  }
  async generateObject<T>(): Promise<any> {
    throw new Error('Members never call generateObject in CouncilAgent.');
  }
  async *streamObject<T>(): AsyncGenerator<any> {
    yield {};
  }
}

const member = (
  id: string,
  llm: BaseLLM<any>,
  providerType = 'openai',
): CouncilMemberSpec => ({
  providerId: `p-${id}`,
  key: `model-${id}`,
  providerType,
  name: `Model ${id.toUpperCase()}`,
  llm,
});

const makeConfig = (
  members: CouncilMemberSpec[],
  chair: BaseLLM<any>,
  over: Partial<CouncilAgentConfig> = {},
): CouncilAgentConfig => ({
  sources: ['web'],
  fileIds: [],
  llm: chair,
  embedding: new FakeEmbedding({}) as any,
  mode: 'speed',
  systemInstructions: '',
  writingMode: true,
  members,
  chairName: 'Chair Model',
  chairProviderId: 'p-chair',
  chairProviderType: 'openai',
  chairKey: 'model-chair',
  ...over,
});

let counter = 0;
const nextIds = () => {
  counter += 1;
  return { chatId: `chat-${counter}`, messageId: `msg-${counter}` };
};

beforeEach(() => {
  dbRows.clear();
});

describe('CouncilAgent orchestration', () => {
  it('survives one member throwing and still runs the chair', async () => {
    const members = [
      member('a', new FakeMemberLLM(['Answer from A.'])),
      member('b', new FakeMemberLLM(['partial before boom'], 'model B blew up'), 'anthropic'),
      member('c', new FakeMemberLLM(['Answer from C.']), 'gemini'),
    ];
    const chair = new FakeChairLLM(['Synthesized verdict.']);
    const config = makeConfig(members, chair);

    const session = SessionManager.createSession();
    const { chatId, messageId } = nextIds();

    await new CouncilAgent().run(session, {
      chatHistory: [],
      followUp: 'test query',
      chatId,
      messageId,
      config,
    });

    const blocks = session.getAllBlocks();
    const councilBlock = blocks.find((b) => b.type === 'council') as CouncilBlock;
    const textBlock = blocks.find((b) => b.type === 'text') as TextBlock;

    expect(councilBlock).toBeDefined();
    expect(councilBlock.data.members).toHaveLength(3);

    const [a, b, c] = councilBlock.data.members;
    expect(a.status).toBe('done');
    expect(a.answer).toBe('Answer from A.');
    expect(b.status).toBe('error');
    expect(b.error).toContain('model B blew up');
    /* The member's own answer-so-far isn't required to be preserved through
       a mid-stream throw — only that it never poisons the batch. */
    expect(c.status).toBe('done');
    expect(c.answer).toBe('Answer from C.');

    /* The chair ran despite one failed member (2 successes clears the
       >=2-survivors bar) and its verdict streamed into the main text block. */
    expect(councilBlock.data.chairStatus).toBe('done');
    expect(textBlock).toBeDefined();
    expect(textBlock.data).toBe('Synthesized verdict.');

    expect(dbRows.get(messageId)?.status).toBe('completed');
  });

  it('degrades to the single answer when exactly one member succeeds, skipping the chair', async () => {
    const members = [
      member('a', new FakeMemberLLM(['solo answer'])),
      member('b', new FakeMemberLLM([], 'everyone else failed'), 'anthropic'),
    ];
    const chair = new FakeChairLLM(['should never stream']);
    const config = makeConfig(members, chair);

    const session = SessionManager.createSession();
    const { chatId, messageId } = nextIds();

    await new CouncilAgent().run(session, {
      chatHistory: [],
      followUp: 'test query',
      chatId,
      messageId,
      config,
    });

    const blocks = session.getAllBlocks();
    const councilBlock = blocks.find((b) => b.type === 'council') as CouncilBlock;
    const textBlock = blocks.find((b) => b.type === 'text') as TextBlock;

    expect(councilBlock.data.chairStatus).toBe('skipped');
    expect(councilBlock.data.chairSkippedReason).toMatch(/one member/i);
    expect(textBlock.data).toBe('solo answer');
  });

  it('degrades to a plain apology and skips the chair when every member fails', async () => {
    const members = [
      member('a', new FakeMemberLLM([], 'boom a')),
      member('b', new FakeMemberLLM([], 'boom b'), 'anthropic'),
    ];
    const chair = new FakeChairLLM(['should never stream']);
    const config = makeConfig(members, chair);

    const session = SessionManager.createSession();
    const { chatId, messageId } = nextIds();

    await new CouncilAgent().run(session, {
      chatHistory: [],
      followUp: 'test query',
      chatId,
      messageId,
      config,
    });

    const blocks = session.getAllBlocks();
    const councilBlock = blocks.find((b) => b.type === 'council') as CouncilBlock;
    const textBlock = blocks.find((b) => b.type === 'text') as TextBlock;

    expect(councilBlock.data.members.every((m) => m.status === 'error')).toBe(true);
    expect(councilBlock.data.chairStatus).toBe('skipped');
    expect(textBlock.data).toMatch(/every model in the council failed/i);
    expect(dbRows.get(messageId)?.status).toBe('completed');
  });

  it('respects an already-aborted signal: members are cancelled and the chair is skipped', async () => {
    const members = [
      member('a', new FakeMemberLLM(['should not stream'])),
      member('b', new FakeMemberLLM(['should not stream']), 'anthropic'),
    ];
    const chair = new FakeChairLLM(['should not stream']);
    const controller = new AbortController();
    controller.abort();
    const config = makeConfig(members, chair, { signal: controller.signal });

    const session = SessionManager.createSession();
    const { chatId, messageId } = nextIds();

    await new CouncilAgent().run(session, {
      chatHistory: [],
      followUp: 'test query',
      chatId,
      messageId,
      config,
    });

    const blocks = session.getAllBlocks();
    const councilBlock = blocks.find((b) => b.type === 'council') as CouncilBlock;

    expect(councilBlock.data.members.every((m) => m.status === 'cancelled')).toBe(true);
    expect(councilBlock.data.chairStatus).toBe('skipped');
    expect(dbRows.get(messageId)?.status).toBe('cancelled');
  });

  it('reads real per-member cost/tokens back from the shared UsageMeter, matched by providerId+model', async () => {
    const { UsageMeter } = await import('@/lib/pricing/meter');
    const usageMeter = new UsageMeter();

    const memberA = new FakeMemberLLM(['Answer A']);
    const memberB = new FakeMemberLLM(['Answer B']);
    memberA.setMeter(usageMeter, {
      providerType: 'openai',
      providerId: 'p-a',
      model: 'model-a',
    });
    memberB.setMeter(usageMeter, {
      providerType: 'anthropic',
      providerId: 'p-b',
      model: 'model-b',
    });
    /* Simulate the OpenAI/Anthropic providers' streamText recording usage —
       FakeMemberLLM itself doesn't, since it stands in for a bare streaming
       call; this asserts CouncilAgent's read-back, not the recording. */
    usageMeter.record({
      providerType: 'openai',
      providerId: 'p-a',
      model: 'model-a',
      inputTokens: 100,
      outputTokens: 50,
    });

    const members = [member('a', memberA), member('b', memberB, 'anthropic')];
    const chair = new FakeChairLLM(['Verdict.']);
    const config = makeConfig(members, chair, { usageMeter });

    const session = SessionManager.createSession();
    const { chatId, messageId } = nextIds();

    await new CouncilAgent().run(session, {
      chatHistory: [],
      followUp: 'test query',
      chatId,
      messageId,
      config,
    });

    const blocks = session.getAllBlocks();
    const councilBlock = blocks.find((b) => b.type === 'council') as CouncilBlock;
    const usageBlock = blocks.find((b) => b.type === 'usage') as any;

    const [a, b] = councilBlock.data.members;
    expect(a.inputTokens).toBe(100);
    expect(a.outputTokens).toBe(50);
    expect(a.free).toBe(false);
    /* Member B never had usage recorded against it -- cost read-back is a
       no-op, not a crash. */
    expect(b.cost).toBeUndefined();

    expect(usageBlock).toBeDefined();
    expect(usageBlock.data.breakdown.some((e: any) => e.providerId === 'p-a')).toBe(true);
  });
});
