// The words of the paragraph being written, kept outside React and the stores: every few characters
// of a streamed turn go straight into that paragraph's text node, so the page does not re-render per
// chunk (implementation guide 五). When the paragraph closes its text moves into the store once.

type Sink = (delta: string) => void;

export class LiveText {
  private readonly texts = new Map<string, string>();
  private readonly sinks = new Map<string, Set<Sink>>();

  open(blockId: string): void {
    this.texts.set(blockId, '');
  }

  append(blockId: string, delta: string): void {
    const text = this.texts.get(blockId);
    if (text === undefined) return;
    this.texts.set(blockId, text + delta);
    this.sinks.get(blockId)?.forEach((sink) => sink(delta));
  }

  /** The words so far, for a paragraph component that mounts in the middle of the stream. */
  read(blockId: string): string {
    return this.texts.get(blockId) ?? '';
  }

  /** Ends the paragraph and hands over its words. */
  close(blockId: string): string {
    const text = this.texts.get(blockId) ?? '';
    this.texts.delete(blockId);
    return text;
  }

  clear(): void {
    this.texts.clear();
  }

  /** Called with each new piece of the paragraph's text; returns the unsubscribe. */
  listen(blockId: string, sink: Sink): () => void {
    const sinks = this.sinks.get(blockId) ?? new Set<Sink>();
    sinks.add(sink);
    this.sinks.set(blockId, sinks);
    return () => {
      sinks.delete(sink);
      if (sinks.size === 0) this.sinks.delete(blockId);
    };
  }
}

/** The one live text of the page. */
export const liveText = new LiveText();
