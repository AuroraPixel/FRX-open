// 建角与捏人 (plan item 50; spec 七, 建角): one step to a screen, the steps as small diamonds above (the walked
// ones solid), 上一步 and 下一步 below: difficulty, birth, race and sex, spirit root, traits, attributes, the
// portrait, name and birthplace, and the summary with 踏入仙途, which makes the save (POST /saves) and opens the
// play screen on it. A large centred frame over the scene on desktops; the whole window on phones.
// Every new save is a cultivation life; creation waits until the server confirms its model is available.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { audio } from '../../audio';
import { isDrawn, useKit, usePicturesTick } from '../../kit/shared';
import { pins, readParams } from '../../lib/params';
import { useReady } from '../../lib/ready';
import { navigate } from '../../router';
import { useUiStore } from '../../store/ui';
import { Btn } from '../../ui/Btn';
import { Dialog } from '../../ui/Dialog';
import { cx } from '../../ui/cx';
import { Frame, frameClass } from '../../ui/Frame';
import { Loading } from '../../ui/Loading';
import { Tool } from '../../ui/Tool';
import { PHONE, useMedia } from '../../ui/useMedia';
import { titleHour, useBackdrop } from '../backdrop/wish';
import { firstPortrait, LookStep } from './LookStep';
import { NamePlaceStep } from './NamePlaceStep';
import { RootStep } from './RootStep';
import { STEPS, pointsLeft, stepDone } from './rules';
import { AttributesStep, BirthStep, DifficultyStep, RaceStep, SummaryStep } from './SimpleSteps';
import { useCreation } from './store';
import { prefill } from './prefill';
import { TraitsStep } from './TraitsStep';
import styles from './Creation.module.css';

/** The steps that spend points show what is left. */
const SPENDING = new Set([1, 2, 3, 4, 5, 8]);

/**
 * The steps as small diamonds. On desktops each is a button back (or on, over steps that are done); on phones
 * nine 44 px targets do not fit across, so they only show where the player is and 上一步/下一步 move.
 */
function Diamonds({
  step,
  onGo,
  done,
  phone,
}: {
  step: number;
  onGo: (step: number) => void;
  done: (step: number) => boolean;
  phone: boolean;
}) {
  return (
    <ol className={styles.diamonds} aria-label="建角的步骤">
      {STEPS.map((name, at) => {
        const state = at === step ? 'here' : at < step ? 'walked' : 'ahead';
        const reachable = STEPS.slice(0, at).every((_, before) => done(before));
        const label = `第 ${at + 1} 步：${name}`;
        return (
          <li key={name} data-state={state} aria-current={at === step ? 'step' : undefined}>
            {phone ? (
              <span className={styles.diamond} role="img" aria-label={label}>
                <i aria-hidden="true" />
              </span>
            ) : (
              <button
                type="button"
                className={styles.diamond}
                aria-label={label}
                title={name}
                disabled={!reachable && at !== step}
                onClick={() => onGo(at)}
              >
                <i aria-hidden="true" />
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function CreationScreen() {
  const { options, error, c, step, load, go, restart, loading } = useCreation();
  const setPortrait = useCreation((s) => s.setPortrait);
  const submit = useCreation((s) => s.submit);
  const kit = useKit();
  const phone = useMedia(PHONE);
  const want = useBackdrop((s) => s.want);
  const drawn = useBackdrop((s) => s.drawn);
  const notify = useUiStore((s) => s.notify);
  const [leaving, setLeaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [figureDrawn, setFigureDrawn] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => void load(), [load]);

  // development and screenshot builds may open on a later step with choices made (?step=)
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (prefilled || !options?.play?.available || !kit) return;
    const wanted = __DEV_PAGES__ ? Number(readParams(location.href).get('step')) : 0;
    if (wanted > 0) void prefill(options, kit, wanted - 1).then(() => setPrefilled(true));
    else setPrefilled(true);
  }, [options, kit, prefilled]);

  // a portrait as soon as the sex is known, so the back view on the stage is theirs from then on
  useEffect(() => {
    if (!kit || !c.sex) return;
    const base = c.portrait ? kit.manifest.bases[c.portrait.base] : undefined;
    if (!c.portrait || base?.sex !== c.sex) setPortrait(firstPortrait(kit, c));
  }, [kit, c, setPortrait]);

  // the scene stays behind at its hour, quiet, softened under the frame; the protagonist is the one made here
  const measure = useCallback(() => {
    const frame = frameRef.current?.getBoundingClientRect();
    const hour = pins().light ? titleHour(undefined) : useBackdrop.getState().wish.hour;
    want({
      hour,
      focus: 'idle',
      still: 1,
      ...(c.portrait ? { protagonist: c.portrait } : {}),
      veil:
        phone || !frame
          ? { x: -400, y: -400, w: innerWidth + 800, h: innerHeight + 800, amount: 0.88 }
          : { x: frame.left - 40, y: frame.top - 40, w: frame.width + 80, h: frame.height + 80, feather: 140, amount: 0.82 },
    });
  }, [want, phone, c.portrait]);
  useEffect(() => {
    measure();
    addEventListener('resize', measure);
    return () => removeEventListener('resize', measure);
  }, [measure, options]);

  // a new step starts at its top
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    setProblem(null);
    if (step !== 6) setFigureDrawn(false);
  }, [step]);

  // drawn once the step's pictures are: the figure of the look step, the head of the summary
  usePicturesTick();
  const lookReady = step !== 6 || figureDrawn;
  const headReady = step !== 8 || !c.portrait || isDrawn(c.portrait, 'head');
  const unavailable = options && !options.play?.available ? options.play?.reason ?? '暂时无法开启修仙人生，请重新检查。' : null;
  useReady(Boolean(error || unavailable) || (options !== null && prefilled && drawn && lookReady && headReady));

  const done = (at: number) => (options ? stepDone(options, c, at) : false);
  const moveTo = (at: number) => {
    audio.play('ui.page');
    go(at);
  };
  const enter = async () => {
    setProblem(null);
    try {
      const made = await submit();
      audio.play('ui.seal');
      restart();
      navigate({ name: 'play', id: made.id });
    } catch (failure) {
      const said = failure instanceof ApiError ? failure.message : new ApiError('network').message;
      audio.play('ui.error');
      setProblem(said);
      if (failure instanceof ApiError && failure.code === 'version_conflict') {
        notify(said, 'error');
        go(7);
      }
    }
  };

  const leave = () => {
    restart();
    navigate({ name: 'title' });
  };

  if (error || unavailable) {
    return (
      <main className={styles.page} aria-label="建角">
        <Frame className={styles.frame} data-ornate="">
          <div className={styles.failed} role="alert">
            <p>{error?.message ?? unavailable}</p>
            <Btn disabled={loading} onClick={() => void load(true)}>{loading ? '检查中……' : '重新检查'}</Btn>
            <Btn onClick={leave}>回到标题</Btn>
          </div>
        </Frame>
      </main>
    );
  }

  const left = options ? pointsLeft(options, c) : 0;
  return (
    <main className={styles.page} aria-labelledby="creation-title">
      <div ref={frameRef} className={cx(frameClass, styles.frame)} data-ornate="">
        <header className={styles.head}>
          <Tool glyph="回" label="回到标题" onClick={() => setLeaving(true)} />
          <div className={styles.heading}>
            <h1 id="creation-title" className={styles.title}>
              {STEPS[step]}
            </h1>
            <span className={styles.stepNo}>
              {`第 ${step + 1} 步，共 ${STEPS.length} 步`}
            </span>
          </div>
          {options && SPENDING.has(step) && (
            <span className={styles.points} data-short={left < 0 ? '' : undefined} aria-live="polite">
              剩余点数 <b>{left}</b>
            </span>
          )}
        </header>
        <Diamonds step={step} onGo={moveTo} done={done} phone={phone} />
        <div ref={bodyRef} className={styles.body} data-step={step}>
          {!options || !prefilled ? (
            <Loading text="铺开命盘……" />
          ) : step === 0 ? (
            <DifficultyStep options={options} c={c} />
          ) : step === 1 ? (
            <BirthStep options={options} c={c} />
          ) : step === 2 ? (
            <RaceStep options={options} c={c} />
          ) : step === 3 ? (
            <RootStep options={options} c={c} />
          ) : step === 4 ? (
            <TraitsStep options={options} c={c} />
          ) : step === 5 ? (
            <AttributesStep options={options} c={c} />
          ) : step === 6 ? (
            <LookStep options={options} kit={kit} c={c} onDrawn={() => setFigureDrawn(true)} />
          ) : step === 7 ? (
            <NamePlaceStep options={options} c={c} />
          ) : (
            <SummaryStep options={options} c={c} onEnter={() => void enter()} problem={problem} />
          )}
        </div>
        <footer className={styles.foot}>
          <Btn onClick={() => (step > 0 ? moveTo(step - 1) : setLeaving(true))}>
            {step > 0 ? '上一步' : '回到标题'}
          </Btn>
          {step < STEPS.length - 1 && (
            <Btn variant="solid" disabled={!options || !done(step)} onClick={() => moveTo(step + 1)}>
              下一步
            </Btn>
          )}
        </footer>
      </div>
      <Dialog
        open={leaving}
        title="回到标题"
        confirmLabel="回到标题"
        cancelLabel="接着建角"
        onConfirm={leave}
        onCancel={() => setLeaving(false)}
      >
        <p>这次建角的选择不会留下。</p>
      </Dialog>
    </main>
  );
}
