import styles from './Badge.module.css';

export type BadgeProps = {
  label: string;
};

export function Badge({ label }: BadgeProps) {
  return `<span class="${styles.badge}">${label}</span>`;
}
