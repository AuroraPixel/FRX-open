// The first-meeting close-ups of the play screen (spec 六, 初遇特写): the people who arrive for the first
// time in the save, queued, one at a time. A close-up waits while a performance is on; once begun it keeps
// the stage. Leaving it remembers the person and puts them in the main place.
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import type { EnterBlock } from '../../contracts';
import { type Cast, step } from './cast';
import type { Meetings } from './meetings';
import { cue } from './showClock';

export function useCloseUp(meetings: Meetings, performing: boolean, setCast: Dispatch<SetStateAction<Cast>>) {
  const [meets, setMeets] = useState<EnterBlock[]>([]);
  const [leaving, setLeaving] = useState(false);
  const meetingOn = useRef(false);

  // a first meeting waits while a performance is on; once begun, it keeps the stage
  const firstMeet = meets[0] ?? null;
  const meeting = firstMeet && (meetingOn.current || !performing) ? firstMeet : null;
  meetingOn.current = meeting !== null;
  const cine = meeting !== null && !leaving;

  const onMeet = useCallback((entry: EnterBlock) => {
    setMeets((queue) => (queue.some((e) => e.charId === entry.charId) ? queue : [...queue, entry]));
  }, []);
  const endMeeting = useCallback(() => {
    if (!meeting) return;
    meetings.remember(meeting);
    setCast((before) => step(before, meeting.charId));
    setLeaving(true);
  }, [meeting, meetings, setCast]);
  const meetingGone = useCallback(() => {
    setMeets((queue) => queue.slice(1));
    setLeaving(false);
  }, []);
  useEffect(() => {
    if (meeting) cue('ui.seal');
  }, [meeting]);

  return { meeting, cine, onMeet, endMeeting, meetingGone };
}
