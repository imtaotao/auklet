export type ChipProps = {
  label: string;
};

export function Chip({ label }: ChipProps) {
  return `<span class="single-chip">${label}</span>`;
}
