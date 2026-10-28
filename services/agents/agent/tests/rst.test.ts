import { describe, expect, it } from 'vitest';
import { inlineRst, isRstPath, rstToMarkdown } from '../src/rst';

describe('inlineRst', () => {
  it('turns literals, roles and links into Markdown', () => {
    expect(inlineRst('Use ``QuerySet`` and :class:`~django.db.models.Model` or :meth:`filter() <QuerySet.filter>`.')).toBe(
      'Use `QuerySet` and `Model` or `filter()`.',
    );
    expect(inlineRst('See :ref:`the guide <topics-db>`, :doc:`/ref/models`, `Python <https://python.org>`_ and `named`_.')).toBe(
      'See the guide, models, [Python](https://python.org) and named.',
    );
  });

  it('drops backslash escapes', () => {
    expect(inlineRst('new :class:`QuerySet`\\s and a\\ b')).toBe('new `QuerySet`s and ab');
  });

  it('handles a role wrapped across lines, footnote references and |version|', () => {
    expect(inlineRst(':ref:`rules for\ntime zones <tz>` [1]_ in |version|')).toBe('rules for time zones in version');
  });
});

describe('rstToMarkdown', () => {
  it('maps title underlines to heading levels in order of appearance', () => {
    const out = rstToMarkdown('Page title\n==========\n\nIntro.\n\nSection\n-------\n\nText.\n\nSub\n~~~\n\nMore.\n\nBack to section\n---------------\n');
    expect(out).toBe('# Page title\n\nIntro.\n\n## Section\n\nText.\n\n### Sub\n\nMore.\n\n## Back to section');
  });

  it('reads overlined titles as their own level', () => {
    expect(rstToMarkdown('=====\nTitle\n=====\n\nBody\n\nSection\n=======\n')).toBe('# Title\n\nBody\n\n## Section');
  });

  it('turns "::" into a code block, and code-block, console and doctests too', () => {
    const src = ['Run this::', '', '    $ pip install x', '', 'Then:', '', '.. code-block:: python', '', '    print(1)', '', '.. console::', '', '    $ ls', '', '>>> 1 + 1', '2', ''].join('\n');
    expect(rstToMarkdown(src)).toBe(
      ['Run this:', '', '```text', '$ pip install x', '```', '', 'Then:', '', '```python', 'print(1)', '```', '', '```console', '$ ls', '```', '', '```python', '>>> 1 + 1', '2', '```'].join('\n'),
    );
  });

  it('renders admonitions as alerts and version notes as quotes', () => {
    const src = '.. note:: First line\n   continues here.\n\n.. warning::\n\n   Careful.\n\n.. versionadded:: 4.2\n\n.. versionchanged:: 5.0\n   Now faster.\n';
    expect(rstToMarkdown(src)).toBe(
      '> [!NOTE]\n> First line\n> continues here.\n\n> [!WARNING]\n> Careful.\n\n> *New in version 4.2.*\n\n> *Changed in version 5.0.* Now faster.',
    );
  });

  it('turns object descriptions into headings with their body, and drops directives with no content', () => {
    const src = '.. currentmodule:: django.db\n\n.. toctree::\n\n   a\n   b\n\n.. class:: Model(**kwargs)\n\n   The base class.\n\n   .. method:: save()\n\n      Saves it.\n';
    expect(rstToMarkdown(src)).toBe('#### `Model(**kwargs)`\n\nThe base class.\n\n#### `save()`\n\nSaves it.');
  });

  it('keeps one heading when a section is titled after the method it describes', () => {
    expect(rstToMarkdown('Filter\n------\n\n``filter()``\n~~~~~~~~~~\n\n.. method:: filter(*args)\n\n   Returns objects.\n')).toBe(
      '# Filter\n\n#### `filter(*args)`\n\nReturns objects.',
    );
  });

  it('dedents quoted and definition text instead of making code blocks, and renders lists', () => {
    const src = 'term\n    its definition\n\n* one\n* two\n  more\n\n#. auto\n#. numbered\n';
    expect(rstToMarkdown(src)).toBe('**term**\n\nits definition\n\n* one\n* two\n  more\n\n1. auto\n1. numbered');
  });

  it('keeps tables as preformatted text and comments disappear', () => {
    const src = '.. a comment\n   continued\n\n=====  =====\nA      B\n=====  =====\n1      2\n=====  =====\n\n+---+---+\n| a | b |\n+---+---+\n';
    expect(rstToMarkdown(src)).toBe('```text\n=====  =====\nA      B\n=====  =====\n1      2\n=====  =====\n```\n\n```text\n+---+---+\n| a | b |\n+---+---+\n```');
  });
});

describe('isRstPath', () => {
  it('accepts .rst anywhere and .txt under docs/', () => {
    expect(isRstPath('docs/topics/db/models.txt')).toBe(true);
    expect(isRstPath('doc/index.rst')).toBe(true);
    expect(isRstPath('README.rst')).toBe(true);
    expect(isRstPath('src/notes.txt')).toBe(false);
    expect(isRstPath('docs/requirements.txt')).toBe(false);
    expect(isRstPath('docs/api.md')).toBe(false);
  });
});
