import styles from './Tag.module.less';

export type TagProps = {
  label: string;
};

export function Tag({ label }: TagProps) {
  return `<span class="${styles.tag}">${label}</span>`;
}
