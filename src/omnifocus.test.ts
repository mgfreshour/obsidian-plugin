import {
  parseSource,
  parseTaskOutput,
  resolveName,
  sourceLabel,
} from './omnifocus';

describe('parseSource', () => {
  it('returns null for empty string', () => {
    expect(parseSource('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(parseSource('   ')).toBeNull();
  });

  it('parses "inbox"', () => {
    expect(parseSource('inbox')).toEqual({ kind: 'inbox' });
  });

  it('parses "INBOX" (case-insensitive)', () => {
    expect(parseSource('INBOX')).toEqual({ kind: 'inbox' });
  });

  it('parses "inbox" with surrounding whitespace', () => {
    expect(parseSource('  inbox  ')).toEqual({ kind: 'inbox' });
  });

  it('parses "project: Foo"', () => {
    expect(parseSource('project: Foo')).toEqual({ kind: 'project', name: 'Foo' });
  });

  it('parses "Project: Foo" (case-insensitive keyword)', () => {
    expect(parseSource('Project: Foo')).toEqual({ kind: 'project', name: 'Foo' });
  });

  it('trims project name whitespace', () => {
    expect(parseSource('project:   My Project  ')).toEqual({
      kind: 'project',
      name: 'My Project',
    });
  });

  it('throws for empty project name', () => {
    expect(() => parseSource('project:   ')).toThrow('Unknown source');
  });

  it('parses "tag: @Work"', () => {
    expect(parseSource('tag: @Work')).toEqual({ kind: 'tag', name: '@Work' });
  });

  it('parses "Tag: Work" (case-insensitive keyword)', () => {
    expect(parseSource('Tag: Work')).toEqual({ kind: 'tag', name: 'Work' });
  });

  it('trims tag name whitespace', () => {
    expect(parseSource('tag:   @Personal  ')).toEqual({
      kind: 'tag',
      name: '@Personal',
    });
  });

  it('throws for empty tag name', () => {
    expect(() => parseSource('tag:   ')).toThrow('Unknown source');
  });

  it('throws for unknown source', () => {
    expect(() => parseSource('nonsense')).toThrow('Unknown source');
  });

  it('lists all valid formats in unknown source error', () => {
    try {
      parseSource('nonsense');
      fail('expected to throw');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('inbox');
      expect(msg).toContain('project: <name>');
      expect(msg).toContain('tag: <name>');
    }
  });
});

describe('resolveName', () => {
  const candidates = ['Alpha', 'Beta', 'Alpha Beta', 'Gamma'];

  it('returns exact match (case-insensitive)', () => {
    expect(resolveName('alpha', candidates, 'project')).toBe('Alpha');
  });

  it('returns exact match preserving original case', () => {
    expect(resolveName('GAMMA', candidates, 'tag')).toBe('Gamma');
  });

  it('prefers exact match over substring', () => {
    expect(resolveName('Alpha', candidates, 'project')).toBe('Alpha');
  });

  it('returns single substring match', () => {
    expect(resolveName('Gam', candidates, 'project')).toBe('Gamma');
  });

  it('throws for ambiguous substring matches', () => {
    expect(() => resolveName('Alpha', ['Alpha One', 'Alpha Two'], 'project')).toThrow(
      'Ambiguous project',
    );
  });

  it('lists ambiguous matches in error', () => {
    try {
      resolveName('eta', candidates, 'tag');
      fail('expected to throw');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('Ambiguous tag "eta"');
      expect(msg).toContain('Beta');
      expect(msg).toContain('Alpha Beta');
      expect(msg).not.toContain('Gamma');
    }
  });

  it('throws for no matches', () => {
    expect(() => resolveName('xyz', candidates, 'project')).toThrow(
      'No project matching "xyz"',
    );
  });

  it('lists all candidates in no-match error', () => {
    try {
      resolveName('xyz', candidates, 'tag');
      fail('expected to throw');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('No tag matching "xyz"');
      expect(msg).toContain('Alpha');
      expect(msg).toContain('Beta');
      expect(msg).toContain('Gamma');
    }
  });

  it('throws for empty candidates list', () => {
    expect(() => resolveName('anything', [], 'project')).toThrow(
      'No project matching "anything"',
    );
  });

  it('uses entityLabel in error messages', () => {
    expect(() => resolveName('x', [], 'tag')).toThrow('No tag matching');
    expect(() => resolveName('x', [], 'project')).toThrow('No project matching');
  });
});

describe('sourceLabel', () => {
  it('returns "inbox" for inbox source', () => {
    expect(sourceLabel({ kind: 'inbox' })).toBe('inbox');
  });

  it('returns project label with quoted name', () => {
    expect(sourceLabel({ kind: 'project', name: 'My Project' })).toBe(
      'project "My Project"',
    );
  });

  it('returns tag label with quoted name', () => {
    expect(sourceLabel({ kind: 'tag', name: '@Work' })).toBe('tag "@Work"');
  });
});

describe('parseTaskOutput', () => {
  it('returns empty array for empty string', () => {
    expect(parseTaskOutput('')).toEqual([]);
    expect(parseTaskOutput('   ')).toEqual([]);
  });

  it('parses single task with name, id, and empty note', () => {
    expect(parseTaskOutput('Buy milk\x1foF123\x1f')).toEqual([
      { name: 'Buy milk', id: 'oF123', note: '' },
    ]);
  });

  it('parses single task with note', () => {
    expect(parseTaskOutput('Buy milk\x1foF123\x1fGet 2%')).toEqual([
      { name: 'Buy milk', id: 'oF123', note: 'Get 2%' },
    ]);
  });

  it('restores newlines in note', () => {
    expect(
      parseTaskOutput('Task\x1foF1\x1fLine one\\nLine two'),
    ).toEqual([{ name: 'Task', id: 'oF1', note: 'Line one\nLine two' }]);
  });

  it('parses multiple tasks', () => {
    const output = 'Task A\x1fid1\x1fNote A\nTask B\x1fid2\x1fNote B';
    expect(parseTaskOutput(output)).toEqual([
      { name: 'Task A', id: 'id1', note: 'Note A' },
      { name: 'Task B', id: 'id2', note: 'Note B' },
    ]);
  });
});
