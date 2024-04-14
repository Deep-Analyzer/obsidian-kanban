/* eslint-disable @typescript-eslint/ban-ts-comment */
import classcat from 'classcat';
import Mark from 'mark.js';
import { MarkdownRenderer as ObsidianRenderer, TFile } from 'obsidian';
import PQueue from 'p-queue';
import { CSSProperties, memo, useEffect, useRef } from 'preact/compat';
import { useContext, useState } from 'preact/hooks';
import { KanbanView } from 'src/KanbanView';

import { applyCheckboxIndexes, renderMarkdown } from '../../helpers/renderMarkdown';
import { KanbanContext } from '../context';
import { c } from '../helpers';

interface MarkdownRendererProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
  markdownString: string;
  searchQuery?: string;
  priority?: number;
}

interface MarkdownPreviewRendererProps extends MarkdownRendererProps {
  entityId: string;
}

function appendOrReplaceFirstChild(wrapper?: HTMLDivElement, child?: HTMLDivElement) {
  if (!child || !wrapper) return;

  if (wrapper && !wrapper.firstChild) {
    wrapper.appendChild(child);
  } else if (wrapper.firstChild && wrapper.firstChild !== child) {
    wrapper.replaceChild(child, wrapper.firstChild);
  }
}

export const StaticMarkdownRenderer = memo(function StaticMarkdownRenderer({
  className,
  markdownString,
  searchQuery,
  ...divProps
}: MarkdownRendererProps) {
  const { stateManager } = useContext(KanbanContext);
  const wrapperRef = useRef<HTMLDivElement>();
  const contentRef = useRef<HTMLDivElement>();
  const markRef = useRef<Mark>();

  useEffect(() => {
    renderMarkdown(stateManager.getAView(), markdownString)
      .then((el) => {
        contentRef.current = el;
        markRef.current = new Mark(el);

        if (wrapperRef.current) {
          appendOrReplaceFirstChild(wrapperRef.current, el);
        }
      })
      .catch((e) => {
        stateManager.setError(e);
        console.error(e);
      });
  }, [stateManager, markdownString]);

  useEffect(() => {
    markRef.current?.unmark();

    if (searchQuery && searchQuery.trim()) {
      markRef.current?.mark(searchQuery);
    }
  }, [searchQuery]);

  return (
    <div
      ref={(node) => {
        wrapperRef.current = node;
        appendOrReplaceFirstChild(node, contentRef.current);
      }}
      className={classcat(['markdown-preview-view', c('markdown-preview-view'), className])}
      {...divProps}
    />
  );
});

export class MarkdownRenderer extends ObsidianRenderer {
  search: null = null;
  owner: KanbanView;

  onFoldChange() {}
  showSearch() {}
  onScroll() {}

  constructor(
    owner: KanbanView,
    el: HTMLElement | DocumentFragment,
    renderOnInsert: boolean = true
  ) {
    // @ts-ignore
    super(owner.app, el, renderOnInsert);
    this.owner = owner;
  }

  lastWidth = -1;
  lastHeight = -1;
  lastRefWidth = -1;
  lastRefHeight = -1;

  observer: ResizeObserver;
  onload() {
    super.onload();

    const { containerEl } = this;

    this.observer = new ResizeObserver((entries) => {
      if (!entries.length) return;

      const entry = entries.first().contentBoxSize[0];
      if (entry.blockSize === 0) return;

      if (
        this.lastWidth >= 0 &&
        (this.lastWidth !== entry.inlineSize || this.lastHeight !== entry.blockSize)
      ) {
        this.renderer.onResize();
      }

      if (this.wrapperEl) {
        const rect = this.wrapperEl.getBoundingClientRect();
        if (this.lastRefHeight === -1 || rect.height > 0) {
          this.lastRefHeight = rect.height;
          this.lastRefWidth = rect.width;
        }
      }

      this.lastWidth = entry.inlineSize;
      this.lastHeight = entry.blockSize;
    });

    containerEl.win.setTimeout(() => {
      this.observer.observe(containerEl, { box: 'border-box' });
    });

    containerEl.addEventListener(
      'pointerdown',
      (evt) => {
        const { targetNode } = evt;
        if (targetNode.instanceOf(HTMLElement) && targetNode.hasClass('task-list-item-checkbox')) {
          if (targetNode.dataset.checkboxIndex === undefined) {
            applyCheckboxIndexes(containerEl);
          }
        }
      },
      { capture: true }
    );

    containerEl.addEventListener(
      'click',
      (evt) => {
        const { targetNode } = evt;
        if (targetNode.instanceOf(HTMLElement) && targetNode.hasClass('task-list-item-checkbox')) {
          evt.preventDefault();
          evt.stopPropagation();
        }
      },
      { capture: true }
    );

    containerEl.addEventListener(
      'contextmenu',
      (evt) => {
        const { targetNode } = evt;
        if (targetNode.instanceOf(HTMLElement) && targetNode.hasClass('task-list-item-checkbox')) {
          evt.preventDefault();
          evt.stopPropagation();
        }
      },
      { capture: true }
    );
  }

  unload(): void {
    super.unload();
    this.observer.disconnect();
  }

  get file(): TFile | null {
    return this.owner.file;
  }

  renderer: any;

  set(content: string): void {
    const { app, renderer } = this;

    renderer.set(content);
    // @ts-ignore
    renderer.previewEl.toggleClass('rtl', app.vault.getConfig('rightToLeft'));
    renderer.previewEl.toggleClass('show-indentation-guide', false);
    renderer.previewEl.toggleClass('allow-fold-headings', false);
    renderer.previewEl.toggleClass('allow-fold-lists', false);
    renderer.unfoldAllHeadings();
    renderer.unfoldAllLists();
  }

  edit(newContent: string) {
    this.renderer.set(newContent);
  }

  wrapperEl: HTMLElement;

  migrate(el: HTMLElement) {
    const { lastRefHeight, lastRefWidth, containerEl } = this;
    this.wrapperEl = el;
    if (lastRefHeight > 0) {
      el.style.width = `${lastRefWidth}px`;
      el.style.height = `${lastRefHeight}px`;
      el.win.setTimeout(() => {
        el.style.width = '';
        el.style.height = '';
      }, 10);
    }
    if (containerEl.parentElement !== el) {
      el.append(containerEl);
    }
  }
}

const q = new PQueue({ concurrency: 50 });

export const MarkdownPreviewRenderer = memo(function MarkdownPreviewRenderer({
  entityId,
  className,
  markdownString,
  searchQuery,
  priority,
  ...divProps
}: MarkdownPreviewRendererProps) {
  const { view } = useContext(KanbanContext);
  const markRef = useRef<Mark>();
  const renderer = useRef<MarkdownRenderer>();
  const elRef = useRef<HTMLDivElement>();
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    if (view.previewCache.has(entityId)) {
      console.log('have cache');

      const preview = view.previewCache.get(entityId);
      renderer.current = preview;
      preview.migrate(elRef.current);

      markRef.current?.unmark();
      markRef.current = new Mark(preview.renderer.previewEl);

      setRendered(true);
      return;
    }

    q.add(
      async () => {
        if (!(view as any)._loaded || !elRef.current) return;
        const containerEl = elRef.current.createDiv();
        console.log('new cache');

        const preview = (renderer.current = view.addChild(new MarkdownRenderer(view, containerEl)));
        preview.wrapperEl = elRef.current;
        preview.set(markdownString);
        markRef.current = new Mark(preview.renderer.previewEl);

        view.previewCache.set(entityId, preview);

        setRendered(true);
        await new Promise((res) => setTimeout(res));
      },
      { priority: priority ?? 0 }
    );
  }, [view, entityId]);

  useEffect(() => {
    const preview = renderer.current;
    if (!rendered || markdownString === preview.renderer.text) return;
    const el = elRef.current;
    if (el) {
      preview.migrate(el);
    }
    renderer.current.set(markdownString);
  }, [rendered, markdownString]);

  useEffect(() => {
    markRef.current?.unmark();
    if (searchQuery && searchQuery.trim()) {
      markRef.current?.mark(searchQuery);
    }
  }, [searchQuery]);

  useEffect(() => {
    if (
      elRef.current &&
      renderer.current &&
      renderer.current.containerEl.parentElement !== elRef.current
    ) {
      renderer.current.migrate(elRef.current);
    }
  }, []);

  let styles: CSSProperties | undefined = undefined;
  if (!renderer.current && view.previewCache.has(entityId)) {
    const preview = view.previewCache.get(entityId);
    if (preview.lastRefHeight > 0) {
      styles = {
        width: `${preview.lastRefWidth}px`,
        height: `${preview.lastRefHeight}px`,
      };
    }
  }

  return (
    <div
      style={styles}
      ref={(el) => {
        elRef.current = el;
        if (el && renderer.current && renderer.current.containerEl.parentElement !== el) {
          renderer.current.migrate(el);
        }
      }}
      className={classcat([c('markdown-preview-wrapper'), className])}
      {...divProps}
    />
  );
});

export const MarkdownClonedPreviewRenderer = memo(function MarkdownClonedPreviewRenderer({
  entityId,
  className,
  ...divProps
}: MarkdownPreviewRendererProps) {
  const { view } = useContext(KanbanContext);
  const renderer = useRef<MarkdownRenderer>();
  const elRef = useRef<HTMLDivElement>();
  const preview = view.previewCache.get(entityId);

  let styles: CSSProperties | undefined = undefined;
  if (!renderer.current && preview) {
    if (preview.lastRefHeight > 0) {
      styles = {
        width: `${preview.lastRefWidth}px`,
        height: `${preview.lastRefHeight}px`,
      };
    }
  }

  return (
    <div
      style={styles}
      ref={(el) => {
        elRef.current = el;
        if (el && preview && el.childElementCount === 0) {
          el.append(preview.containerEl.cloneNode(true));
        }
      }}
      className={classcat([c('markdown-preview-wrapper'), className])}
      {...divProps}
    />
  );
});
