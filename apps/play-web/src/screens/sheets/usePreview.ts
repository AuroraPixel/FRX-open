// A command's preview (POST …/preview), asked again whenever the command changes and has rested a moment;
// an answer to an older command is dropped. The panels of the cultivation life that end in a command
// (差事, 买卖, 炼制) read it the same way the cultivation panel does.
import { useEffect, useRef, useState } from 'react';
import { ApiError, play } from '../../api/client';
import type { Verb, VerbPreview } from '../../contracts';

const SETTLE_MS = 150;

export function usePreview(saveId: string, verb: Verb | null): { preview: VerbPreview | null; problem: string | null; asking: boolean } {
  const [preview, setPreview] = useState<VerbPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const asked = verb ? JSON.stringify(verb) : '';
  const first = useRef(true);
  useEffect(() => {
    if (!asked) {
      setPreview(null);
      setProblem(null);
      setAsking(false);
      return;
    }
    const stop = new AbortController();
    setAsking(true);
    const timer = setTimeout(
      () =>
        void play.preview(saveId, JSON.parse(asked) as Verb, stop.signal).then(
          (answer) => {
            if (stop.signal.aborted) return;
            setPreview(answer);
            setProblem(null);
            setAsking(false);
          },
          (error: unknown) => {
            if (stop.signal.aborted) return;
            setPreview(null);
            setProblem(error instanceof ApiError ? error.message : '没能推算出来，稍后再试。');
            setAsking(false);
          },
        ),
      first.current ? 0 : SETTLE_MS,
    );
    first.current = false;
    return () => {
      clearTimeout(timer);
      stop.abort();
    };
  }, [saveId, asked]);
  return { preview, problem, asking };
}
