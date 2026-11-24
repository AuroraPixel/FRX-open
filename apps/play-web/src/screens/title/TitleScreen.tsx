// 标题页 (plan item 48; spec 七, 标题页): the cloud terrace on the stage at the idle camera, swaying
// slowly; the vertical title in brush with the painted title clouds; the actions 继续 (only with saves,
// glowing), 新开一局, 读取存档 and 设置; the version and andrewwang at the bottom right. The hour is the one
// the save to go on with stands at, and its protagonist sits on the terrace. Sound starts with the first
// tap (the app listens for it). In accounts mode, while nobody is signed in, the login stands where the
// actions do (plan item 68), over the stage's own night with nobody's figure on the terrace.
import { useEffect, useState } from 'react';
import { version } from '../../../package.json';
import { ApiError, play } from '../../api/client';
import type { SaveSummary } from '../../contracts';
import { audio } from '../../audio';
import { useReady } from '../../lib/ready';
import { navigate } from '../../router';
import { useAccount } from '../../store/account';
import { Act } from '../../ui/Act';
import { LoginPanel } from '../account/LoginPanel';
import { useBackdrop, latestSave, titleHour, TITLE_WISH } from '../backdrop/wish';
import { SettingsSheet } from './SettingsSheet';
import styles from './TitleScreen.module.css';

/** 「第 48 回」 */
function turnsSaid(turns: number): string {
  return turns > 0 ? `第 ${turns} 回` : '尚未动身';
}

export function TitleScreen() {
  const phase = useAccount((s) => s.phase);
  const options = useAccount((s) => s.options);
  const [saves, setSaves] = useState<SaveSummary[] | null>(null);
  const [failed, setFailed] = useState<ApiError | null>(null);
  const [settings, setSettings] = useState(false);
  const want = useBackdrop((s) => s.want);
  const drawn = useBackdrop((s) => s.drawn);
  const open = phase === 'local' || phase === 'in';
  const login = phase === 'out';

  // who is here (the app asks once; a title on its own asks too)
  useEffect(() => void useAccount.getState().start(), []);

  // the saves once it is known whose they are
  useEffect(() => {
    if (!open) return;
    let live = true;
    play.saves().then(
      (list) => live && setSaves(list),
      (problem: unknown) => {
        if (!live) return;
        setFailed(problem instanceof ApiError ? problem : new ApiError('network'));
        setSaves([]);
      },
    );
    return () => {
      live = false;
    };
  }, [open]);

  const latest = saves ? latestSave(saves) : undefined;
  useEffect(() => {
    if (login) {
      want({ ...TITLE_WISH, hour: titleHour(undefined), protagonist: undefined });
      return;
    }
    if (!saves) return;
    // with no save, nobody of before: the figure the backdrop last had (a save since deleted, the one a
    // creation was making) stayed on the terrace (the documents pass, #18)
    want({ ...TITLE_WISH, hour: titleHour(latest), protagonist: latest?.player.portrait });
  }, [login, saves, latest, want]);

  useReady(drawn && (login ? options !== null : saves !== null));

  const go = (to: () => void) => () => {
    audio.play('ui.tap');
    to();
  };

  return (
    <main className={styles.title} aria-labelledby="title-name" data-login={login ? '' : undefined}>
      <div className={styles.hills} aria-hidden="true" />
      <div className={styles.clouds} aria-hidden="true" />
      <div className={styles.mark}>
        <p className={styles.motto}>一介凡人 · 问道长生</p>
        <h1 id="title-name" className={styles.name}>
          云汀修行录
        </h1>
      </div>
      {login && <LoginPanel />}
      {open && (
        <nav className={styles.acts} aria-label="开始">
          {latest && (
            <Act
              glyph="续"
              name="继续"
              note={`${latest.name} · ${latest.place} · ${turnsSaid(latest.turns)}`}
              hot
              onClick={go(() => navigate({ name: 'play', id: latest.id }))}
            />
          )}
          <Act glyph="新" name="新开一局" note="另起一段仙途" onClick={go(() => navigate({ name: 'new' }))} />
          <Act
            glyph="卷"
            name="读取存档"
            note={saves && saves.length > 0 ? `${saves.length} 个存档` : failed ? failed.message : '尚无存档'}
            onClick={go(() => navigate({ name: 'saves' }))}
          />
          <Act glyph="设" name="设置" note="显示、声音与模型" onClick={go(() => setSettings(true))} />
        </nav>
      )}
      <p className={styles.sign}>
        <span>v{version}</span>
        <span>andrewwang</span>
      </p>
      <SettingsSheet open={settings && open} saveId={latest?.id ?? null} onClose={() => setSettings(false)} />
    </main>
  );
}
