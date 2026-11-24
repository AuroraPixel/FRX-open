// The name plate beside the one standing in the main place (spec 四, 名牌): three vertical lines read
// from the right, the name in brush, the role with a gold rule, the relation's small seal. Phones use
// the narrow plate, the name and the seal only (spec 十一). A foe in a fight of the cultivation life
// (gameplay plan item 21) has its intent under the plate, in cinnabar brush (「看不透」 when it cannot be
// seen), and the small tags of its state.
import type { Block } from '../../contracts';
import { Seal } from '../../ui/Marks';
import styles from './NamePlate.module.css';

export interface NamePlateProps {
  name: string;
  role?: string;
  relation?: string;
  /** a foe in a fight of the cultivation life: what it means to do next (absent: it cannot be seen) and its tags */
  fight?: { intent?: string; tags: string[] };
}

/** A tag that warns: an opening, a charge. */
export const sharpTag = (tag: string): boolean => /破绽|蓄势/.test(tag);

/** A foe's intent and tags, under its plate or its name over the stage. */
export function FoeIntent({ intent, tags, className }: { intent?: string; tags: string[]; className?: string }) {
  return (
    <div className={className ? `${styles.fight} ${className}` : styles.fight}>
      <p className={styles.intent} data-hidden={intent ? undefined : ''}>
        打算<b>{intent ?? '看不透'}</b>
      </p>
      {tags.length > 0 && (
        <p className={styles.tags}>
          {tags.map((tag) => (
            <span key={tag} className={styles.tag} data-sharp={sharpTag(tag) ? '' : undefined}>
              {tag}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

export function NamePlate({ name, role, relation, fight }: NamePlateProps) {
  return (
    <aside className={styles.plate} aria-label={`在场 · ${name}`} data-fight={fight ? '' : undefined}>
      <b className={styles.name}>{name}</b>
      {role && <span className={styles.role}>{role}</span>}
      {relation && <Seal glyph={relation} small className={styles.seal} />}
      {fight && <FoeIntent intent={fight.intent} tags={fight.tags} className={styles.under} />}
    </aside>
  );
}

/** The plate of whoever stands in the main place: from the state view, else from the turn's own words. */
export function plateFor(
  id: string,
  person: { name: string; role?: string; realm: string; relation?: string } | undefined,
  blocks: readonly Block[] | undefined,
): NamePlateProps | null {
  if (person) {
    const role = [person.role, person.realm].filter(Boolean).join(' · ');
    return { name: person.name, ...(role ? { role } : {}), ...(person.relation ? { relation: person.relation } : {}) };
  }
  for (const block of blocks ?? []) {
    if (block.type === 'enter' && block.charId === id) {
      return { name: block.name, ...(block.role ? { role: block.role } : {}), ...(block.relation ? { relation: block.relation } : {}) };
    }
  }
  for (const block of blocks ?? []) {
    if (block.type === 'speech' && block.speaker.charId === id) return { name: block.speaker.name };
  }
  return null;
}
