import { describe, it, expect } from 'vitest';
import { parseAgentList } from '../src/utils/agent-list.js';

describe('parseAgentList', () => {
  it('reads named agents from RPA_AGENT_URLS', () => {
    expect(parseAgentList('VM2=http://localhost:8080, VM1=http://10.122.2.27:8080', undefined)).toEqual([
      { name: 'VM2', url: 'http://localhost:8080' },
      { name: 'VM1', url: 'http://10.122.2.27:8080' },
    ]);
  });

  it('names unnamed agents by host:port', () => {
    expect(parseAgentList('http://localhost:8080,http://10.122.2.27:8080', undefined)).toEqual([
      { name: 'localhost:8080', url: 'http://localhost:8080' },
      { name: '10.122.2.27:8080', url: 'http://10.122.2.27:8080' },
    ]);
  });

  it('falls back to the single RPA_AGENT_URL', () => {
    expect(parseAgentList('', 'http://localhost:8080 ')).toEqual([
      { name: 'localhost:8080', url: 'http://localhost:8080' },
    ]);
  });

  it('defaults to localhost:8080 when nothing is set', () => {
    expect(parseAgentList(undefined, undefined)).toEqual([
      { name: 'localhost:8080', url: 'http://localhost:8080' },
    ]);
  });

  it('rejects the same agent listed twice', () => {
    expect(() => parseAgentList('http://localhost:8080,http://localhost:8080/', undefined)).toThrow(/twice/);
  });

  it('rejects two agents with the same name', () => {
    expect(() => parseAgentList('VM1=http://a:8080,VM1=http://b:8080', undefined)).toThrow(/same name/);
  });

  it('rejects an invalid URL', () => {
    expect(() => parseAgentList('VM1=10.122.2.27:8080x', undefined)).toThrow(/Invalid RPA agent URL/);
  });
});
