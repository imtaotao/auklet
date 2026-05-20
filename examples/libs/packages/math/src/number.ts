import { isNumber } from 'aidly';

export const add = (left: number, right: number) => {
  if (!isNumber(left) || !isNumber(right)) {
    throw new TypeError('add expects number arguments');
  }

  return left + right;
};
