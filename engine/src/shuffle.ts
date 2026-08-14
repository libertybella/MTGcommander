export function shuffleInPlace<T>(items: T[], random: () => number = Math.random): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(random() * (index + 1));
    const current = items[index];
    const other = items[swapWith];
    if (current === undefined || other === undefined) {
      continue;
    }
    items[index] = other;
    items[swapWith] = current;
  }
}
