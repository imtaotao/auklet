export type ButtonProps = {
  label: string;
};

export function Button({ label }: ButtonProps) {
  return `<button class="single-button" type="button">${label}</button>`;
}
