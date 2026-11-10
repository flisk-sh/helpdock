import { describe, expect, it, vi } from 'vitest';
import { centerPage } from '../src/ui';

// The help center's own script, as the browser runs it: the typewriter the question box uses.
const script = centerPage.slice(centerPage.indexOf('<script>') + 8, centerPage.lastIndexOf('</script>'));
const typewriterSrc = script.slice(script.indexOf('function typewriter'), script.indexOf('var base ='));

function load(reducedMotion: boolean) {
  const window = { matchMedia: () => ({ matches: reducedMotion }) };
  const document = { activeElement: null };
  return new Function('window', 'document', `${typewriterSrc}; return typewriter;`)(window, document) as (
    input: unknown,
    phrases: string[],
    prefix: string,
  ) => { set: (list: string[], fixed?: boolean) => void };
}

function input() {
  return { placeholder: '', value: '', addEventListener: () => {} };
}

describe('the question box placeholder', () => {
  it('names the page being read, and goes back to the examples on the home view', () => {
    vi.useFakeTimers();
    const box = input();
    const typer = load(false)(box, ['Quickstart guide', 'Running in CI'], 'Ask about ');
    vi.advanceTimersByTime(20_000);
    typer.set(['Leaving Flisk'], true);
    expect(box.placeholder).toBe('Ask about Leaving Flisk');
    vi.advanceTimersByTime(20_000); // a fixed phrase is not typed over
    expect(box.placeholder).toBe('Ask about Leaving Flisk');
    typer.set(['Quickstart guide', 'Running in CI']);
    vi.advanceTimersByTime(20_000);
    expect(box.placeholder).not.toContain('Leaving Flisk');
    vi.useRealTimers();
  });

  it('works with reduced motion too', () => {
    const box = input();
    const typer = load(true)(box, ['Quickstart guide'], 'Ask about ');
    expect(box.placeholder).toBe('Ask about Quickstart guide');
    typer.set(['Leaving Flisk'], true);
    expect(box.placeholder).toBe('Ask about Leaving Flisk');
  });

  it('is set from the page that opens, not only from the start pages', () => {
    const openPage = script.slice(script.indexOf('function openPage'), script.indexOf('// A Copy button'));
    expect(openPage).toContain('askAbout(known.title)');
    expect(openPage).toContain('askAbout(p.title)');
    expect(openPage).toContain('pageTitle(p.title)');
  });
});
