import { isNumber } from 'aidly';

export function add(left: number, right: number) {
  if (!isNumber(left) || !isNumber(right)) {
    throw new TypeError('add expects number arguments');
  }

  return left + right;
}
